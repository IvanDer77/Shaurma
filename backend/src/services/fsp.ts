import { config } from "../config.js";
import { HttpError } from "../errors.js";

/**
 * Клиент реестра ФСП. API ФСП в рамках хакатона не предоставляется — используем
 * собственный мок-сервис (fsp-mock) с предложенной нами структурой данных.
 * Схема интеграции описана в docs/ИНТЕГРАЦИЯ ФСП.md.
 */
export interface FspAchievement {
  event: string;
  date: string;
  discipline: "algorithmic" | "product" | "security" | "robotics" | "uav";
  discipline_title: string;
  level: "city" | "regional" | "federal_district" | "national" | "international";
  level_title: string;
  place: number | null;
  participants: number;
  team: string | null;
  role: string | null;
  rank_title: string | null; // спортивный разряд
}

export async function fspParticipant(fspId: string): Promise<{ fsp_id: string; full_name: string; email: string | null; achievements: FspAchievement[] } | null> {
  try {
    const res = await fetch(`${config.fspUrl}/api/v1/participants/${encodeURIComponent(fspId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as any;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "Реестр ФСП временно недоступен. Профиль работает и без данных ФСП.");
  }
}
