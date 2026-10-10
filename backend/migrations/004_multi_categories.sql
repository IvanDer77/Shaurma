-- Несколько категорий у кандидата (ответ организаторов VS.2: «поддержка нескольких — плюс»).
-- Основная категория по-прежнему лежит в candidates.specialization/grade; здесь — ВСЕ подтверждённые тестом
-- категории (основная + дополнительные), по одной на специализацию, у каждой свои 90 дней на смену грейда.
CREATE TABLE candidate_categories (
  candidate_id   uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  specialization text NOT NULL,
  grade          text NOT NULL,
  theta          real,
  confirmed_at   timestamptz NOT NULL DEFAULT now(),
  locked_until   timestamptz,
  is_primary     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (candidate_id, specialization)
);
CREATE INDEX candidate_categories_cat ON candidate_categories (specialization, grade);

INSERT INTO candidate_categories (candidate_id, specialization, grade, theta, confirmed_at, locked_until, is_primary)
SELECT user_id, specialization, grade, theta, COALESCE(grade_confirmed_at, now()), grade_locked_until, true
FROM candidates WHERE grade IS NOT NULL AND specialization IS NOT NULL;

-- Одна строка на (кандидат, категория): поиск, подборка и карта рынка видят кандидата в каждой его категории
CREATE VIEW candidate_category_view AS
SELECT c.user_id, c.anon_code, c.full_name, c.phone, c.telegram, c.city, c.about, c.stacks, c.formats, c.salary_expect,
       c.experience_years, c.soft_skills, c.survey, c.declared_grade, c.ratings, c.fsp_id, c.fsp_linked_at, c.fsp_achievements,
       c.resume_parsed, c.privacy, c.consent_processing, c.consent_publish, c.consent_at, c.last_active_at, c.synthetic,
       cc.specialization, cc.grade, cc.theta, cc.confirmed_at AS grade_confirmed_at, cc.locked_until AS grade_locked_until, cc.is_primary
FROM candidates c JOIN candidate_categories cc ON cc.candidate_id = c.user_id;
