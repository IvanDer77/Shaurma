-- Ответы организаторов и сверка с ТЗ:
--  VS.4  — ФИО и места работы показывать допустимо (закрываются только контакты): по умолчанию видны, анонимность — опция;
--  ТЗ    — «история опроса и теста»: храним каждую версию опроса;
--  ТЗ/критерии — «корректность категоризации по стеку»: стек, подтверждённый решёнными заданиями теста;
--  ТЗ    — «система периодически предлагает кандидату задачу от работодателя»: журнал адресных предложений.
ALTER TABLE candidates ALTER COLUMN privacy
  SET DEFAULT '{"show_name": true, "show_city": true, "show_salary": true, "show_experience": true, "searchable": true}';
ALTER TABLE candidates ADD COLUMN verified_stacks text[] NOT NULL DEFAULT '{}';

CREATE TABLE survey_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  survey       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX survey_history_candidate ON survey_history (candidate_id, created_at DESC);
INSERT INTO survey_history (candidate_id, survey, created_at)
SELECT user_id, survey, COALESCE(consent_at, now()) FROM candidates WHERE survey IS NOT NULL;

CREATE TABLE task_offers (
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  offered_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, candidate_id)
);

-- Представление категорий должно видеть новый столбец
DROP VIEW candidate_category_view;
CREATE VIEW candidate_category_view AS
SELECT c.user_id, c.anon_code, c.full_name, c.phone, c.telegram, c.city, c.about, c.stacks, c.formats, c.salary_expect,
       c.experience_years, c.soft_skills, c.survey, c.declared_grade, c.ratings, c.fsp_id, c.fsp_linked_at, c.fsp_achievements,
       c.resume_parsed, c.privacy, c.consent_processing, c.consent_publish, c.consent_at, c.last_active_at, c.synthetic, c.verified_stacks,
       cc.specialization, cc.grade, cc.theta, cc.confirmed_at AS grade_confirmed_at, cc.locked_until AS grade_locked_until, cc.is_primary
FROM candidates c JOIN candidate_categories cc ON cc.candidate_id = c.user_id;
