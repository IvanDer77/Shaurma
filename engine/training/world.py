"""Синтетический мир для «года жизни платформы» — с истиной, которую модели не видят.

Что известно миру, но не платформе:
  * истинные сложности шаблонов и начинок и их дискриминации — эксперт ошибся в них
    примерно настолько, насколько ошибаются эксперты в психометрической литературе
    (корреляция экспертной и эмпирической сложности ~0,6–0,8);
  * истинные навыки кандидатов по каждому ингредиенту;
  * как кандидаты решают, принять ли приглашение (деньги, формат, переквалификация, репутация компании);
  * кого работодатель в итоге нанимает (истинное совпадение навыков с истинным заказом);
  * «вирусный разбор»: с 7-го месяца приём одной начинки становится общеизвестным.
"""
from __future__ import annotations

import math
import random

import numpy as np

from app import cat, glicko
from app.ingredients import GRADE_IDS, GRADES, SPECIALIZATIONS
from app.templates import ALL_TEMPLATES, CATALOG, ingredients_of
from validation import simulate as S

GRADE_CENTER = {"intern": -1.6, "junior": -0.5, "middle": 0.5, "senior": 1.5}
SALARY_BASE = {"intern": 70_000, "junior": 140_000, "middle": 230_000, "senior": 330_000}
FORMATS = ["remote", "hybrid", "office"]


class World:
    def __init__(self, seed: int = 7, sd_b0: float = 0.45, sd_eta: float = 0.35, sd_loga: float = 0.3):
        rng = np.random.default_rng(seed)
        self.rng = random.Random(seed)
        t_ids = [t.id for t in ALL_TEMPLATES]
        o_ids = [f"{t.id}:{o.id}" for t in ALL_TEMPLATES for o in t.ops]
        d_b0 = rng.normal(0, sd_b0, len(t_ids))
        d_b0 -= d_b0.mean()                        # шкала эксперта и мира совпадают в среднем (как в linking)
        d_eta = rng.normal(0, sd_eta, len(o_ids))
        la = rng.normal(0, sd_loga, len(t_ids))
        la -= la.mean()
        self.b0 = {k: CATALOG[k].b0 + d for k, d in zip(t_ids, d_b0)}
        self.eta = {k: CATALOG[k.split(":")[0]].op(k.split(":")[1]).eta + d for k, d in zip(o_ids, d_eta)}
        self.a = {k: 1.7 * math.exp(x) for k, x in zip(t_ids, la)}
        self.viral: str | None = None              # ключ «шаблон:начинка», приём которой стал общеизвестен
        self.viral_share = 0.0

    def truth(self) -> dict:
        return {"b0": self.b0, "eta": self.eta, "a": self.a}

    def b_true(self, tid: str, ops, knows_trick: bool) -> float:
        b = self.b0[tid]
        for o in ops:
            k = f"{tid}:{o}"
            e = self.eta[k]
            if knows_trick and k == self.viral:
                e -= 1.3                            # разбор видели — начинка перестала быть ловушкой
            b += e
        return b

    # ------------------------------------------------------------ кандидаты
    def people(self, n: int, start_id: int) -> list[dict]:
        pop = S.make_population(n, self.rng)
        for i, p in enumerate(pop):
            p["id"] = f"p{start_id + i}"
            p["formats"] = self.rng.sample(FORMATS, self.rng.choice([1, 1, 2, 3]))
            p["stale_days"] = self.rng.choice([1, 3, 7, 14, 30, 60, 120])
            p["knows_trick"] = self.rng.random() < self.viral_share
        return pop

    def answer(self, p: dict, tid: str, ops) -> bool:
        t = CATALOG[tid]
        th = S.item_theta(p, ingredients_of(t, ops))
        b = self.b_true(tid, ops, p["knows_trick"])
        prob = 0.25 + 0.75 / (1 + math.exp(-self.a[tid] * (th - b)))
        return self.rng.random() < prob

    def run_cat(self, p: dict, declared: str, log: list, ts: list):
        resps, used, tested, sess = [], set(), set(), []
        while True:
            st = cat.step(p["spec"], declared, resps, used, tested, None, self.rng)
            if st["done"]:
                d = st["decision"]
                for it in sess:
                    it["theta"] = d["theta"]
                log += sess
                return d, sess
            nxt = st["next"]
            ok = self.answer(p, nxt["template_id"], nxt["ops"])
            resps.append(cat.Response(nxt["template_id"], tuple(nxt["ops"]), nxt["b"], ok, 4))
            used.add((nxt["template_id"], tuple(sorted(nxt["ops"]))))
            ings = ingredients_of(CATALOG[nxt["template_id"]], nxt["ops"])
            tested |= set(ings)
            ts[0] += 1
            sess.append({"person": p["id"], "template_id": nxt["template_id"], "ops": list(nxt["ops"]), "b": nxt["b"],
                         "correct": ok, "n_options": 4, "ingredients": ings, "ts": ts[0]})

    def categorize(self, p: dict, log: list, ts: list) -> str:
        """Путь по ТЗ: тест на заявленный грейд → (не подтвердил) тест на уровень ниже; уверенным — тест выше."""
        declared, all_items = p["declared"], []
        while True:
            d, items = self.run_cat(p, declared, log, ts)
            all_items += items
            if d["status"] == "confirmed":
                grade = declared
                if d.get("upgrade_offer"):
                    d2, items2 = self.run_cat(p, d["upgrade_offer"], log, ts)
                    all_items += items2
                    if d2["status"] == "confirmed":
                        grade = d["upgrade_offer"]
                break
            if not d.get("retake_lower"):
                grade = "intern"
                break
            declared = d["retake_lower"]
        p["grade"] = grade
        p["ratings"] = glicko.apply_session({}, all_items, "2026-10-01T00:00:00+00:00")
        return grade

    # ------------------------------------------------------------ рынок
    def vacancy(self, gen, vid: int) -> dict:
        v = gen.make(self.rng)
        spec = v["specialization"]
        own = SPECIALIZATIONS[spec]["ingredients"]
        w = {i: (1.0 if i in v["ingredients"] else 0.2) for i in own}
        for i in v["ingredients"]:
            w[i] = 1.0
        tot = sum(w.values())
        lo = SALARY_BASE[v["grade"]] * self.rng.uniform(0.85, 1.1)
        return {"id": f"v{vid}", "text": v["text"], "truth": {"specialization": spec, "grade": v["grade"],
                "ingredients": {k: x / tot for k, x in w.items()}, "key": v["ingredients"]},
                "offer": {"salary_from": int(lo), "salary_to": int(lo * self.rng.uniform(1.15, 1.4)),
                          "formats": self.rng.sample(FORMATS, self.rng.choice([1, 2, 3])),
                          "trust": int(self.rng.choice([60, 85, 100, 100, 110, 130]))},
                "stacks": self.rng.sample(SPECIALIZATIONS[spec]["stacks"], 2)}

    def relevance(self, p: dict, v: dict) -> float:
        tr = v["truth"]
        if p["spec"] != tr["specialization"]:
            return 0.0
        req = GRADE_CENTER[tr["grade"]]
        skill = sum(w * (1 / (1 + math.exp(-1.7 * (p["skills"][i] - req)))) for i, w in tr["ingredients"].items() if i in p["skills"])
        stack = len(set(p["stacks"]) & set(v["stacks"])) / len(v["stacks"])
        return skill * (0.8 + 0.2 * stack)

    def p_hire(self, p: dict, v: dict) -> float:
        """Нанимают, если на собеседовании навыки подтвердились (истинная релевантность)."""
        return 1 / (1 + math.exp(-7 * (self.relevance(p, v) - 0.55)))

    def p_accept(self, p: dict, v: dict) -> float:
        o = v["offer"]
        r = math.log(o["salary_to"] / p["salary"])
        gd = GRADE_IDS.index(p.get("grade") or "intern") - GRADE_IDS.index(v["truth"]["grade"])
        z = (0.6 + 4.0 * min(r, 0.0) + 0.8 * min(max(r, 0), 0.3)
             - (1.6 if not set(o["formats"]) & set(p["formats"]) else 0.0)
             + 0.7 * len(set(p["stacks"]) & set(v["stacks"])) / 2
             - 0.9 * max(0, gd)
             + 0.9 * (o["trust"] - 100) / 50
             - 0.4 * p["fsp"]
             - 0.9 * min(1, p["stale_days"] / 120))
        return 1 / (1 + math.exp(-z))
