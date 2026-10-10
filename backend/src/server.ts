import { createApp } from "./app.js";
import { config } from "./config.js";
import { catalog } from "./engine.js";
import { migrate } from "./migrate.js";
import { setIngredientTitles } from "./services/pdf.js";

async function waitEngine(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const cat = await catalog();
      setIngredientTitles(cat.ingredients);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.warn("Движок ШАУРМА недоступен — запуск без кэша каталога");
}

await migrate();
await waitEngine();
if (process.env.SEED_ON_START === "true") {
  const { seedDemo } = await import("./seed.js");
  await seedDemo().catch((e) => console.error("seed failed:", e));
}
createApp().listen(config.port, () => console.log(`шаурматч_ API: http://localhost:${config.port}/api/docs`));
// «Маринад»: догоняем обучение на накопленных данных (в фоне, API уже работает)
import("./services/learning.js").then((m) => m.startupLearning()).catch((e) => console.warn("Маринад:", e.message));
// «Свежая начинка»: периодически предлагаем адресные задачи кандидатам, чей профиль остывает
import("./services/practice.js").then((m) => m.startPracticeScheduler());
