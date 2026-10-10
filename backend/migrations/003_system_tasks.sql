-- «Свежая начинка»: регулярные задачи, которые система сама адресно предлагает кандидату (ТЗ, п. 2)
ALTER TABLE tasks ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE tasks ADD COLUMN kind text NOT NULL DEFAULT 'employer' CHECK (kind IN ('employer', 'system'));
ALTER TABLE tasks ADD COLUMN candidate_id uuid REFERENCES candidates(user_id) ON DELETE CASCADE;  -- адресат системной задачи
ALTER TABLE tasks ADD COLUMN reason jsonb;                                                       -- почему предложена: ингредиент, причина
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_owner CHECK (
  (kind = 'employer' AND company_id IS NOT NULL) OR (kind = 'system' AND candidate_id IS NOT NULL));
CREATE INDEX tasks_candidate ON tasks (candidate_id, created_at DESC) WHERE candidate_id IS NOT NULL;
