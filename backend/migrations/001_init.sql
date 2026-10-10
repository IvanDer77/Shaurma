-- шаурматч_ · схема данных (PostgreSQL)

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text,
  role          text NOT NULL CHECK (role IN ('candidate', 'employer', 'admin')),
  email_verified boolean NOT NULL DEFAULT false,
  verify_token  text,
  keycloak_sub  text UNIQUE,                       -- связь с ФСП ID (Keycloak), если вход через OIDC
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  anon_code        text NOT NULL UNIQUE,           -- «Кандидат #4821» для слепого отбора
  full_name        text,
  phone            text,
  telegram         text,
  city             text,
  about            text,
  specialization   text,                           -- backend | frontend | data
  stacks           text[] NOT NULL DEFAULT '{}',
  formats          text[] NOT NULL DEFAULT '{remote}',
  salary_expect    integer,
  experience_years real,
  soft_skills      text[] NOT NULL DEFAULT '{}',
  survey           jsonb,                          -- ответы опроса по отрасли и специализации
  declared_grade   text,
  grade            text,                           -- подтверждённый тестом грейд (категория = specialization × grade)
  grade_confirmed_at timestamptz,
  grade_locked_until timestamptz,                  -- смена грейда не чаще раза в 90 дней
  theta            real,
  ratings          jsonb NOT NULL DEFAULT '{}',    -- Glicko-2 по ингредиентам («вертел»)
  fsp_id           text,
  fsp_linked_at    timestamptz,
  fsp_achievements jsonb NOT NULL DEFAULT '[]',
  resume_parsed    jsonb,
  privacy          jsonb NOT NULL DEFAULT '{"show_name": false, "show_city": true, "show_salary": true, "searchable": true}',
  consent_processing boolean NOT NULL DEFAULT false,
  consent_publish    boolean NOT NULL DEFAULT false,
  consent_at       timestamptz,
  last_active_at   timestamptz NOT NULL DEFAULT now(),
  synthetic        boolean NOT NULL DEFAULT false
);
CREATE INDEX candidates_category ON candidates (specialization, grade);

CREATE TABLE test_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  specialization text NOT NULL,
  declared_grade text NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'abandoned')),
  theta          real,
  se             real,
  decision       jsonb,
  antileak       jsonb,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);

CREATE TABLE test_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  position       integer NOT NULL,
  variant_id     text NOT NULL,                    -- «соус»: отпечаток уникального варианта
  template_id    text NOT NULL,
  ops            text[] NOT NULL,
  seed           bigint NOT NULL,
  b              real NOT NULL,
  ingredients    text[] NOT NULL,
  language       text NOT NULL,
  kind           text NOT NULL,
  title          text NOT NULL,
  prompt         text NOT NULL,
  code           text NOT NULL,
  options        jsonb NOT NULL,
  correct_option text NOT NULL,
  correct_label  text NOT NULL,
  answer_option  text,
  answer_label   text,
  correct        boolean,
  seconds        real,
  canary         jsonb,
  shown_at       timestamptz NOT NULL DEFAULT now(),
  answered_at    timestamptz
);
CREATE INDEX test_items_template ON test_items (template_id);

CREATE TABLE grade_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  session_id     uuid REFERENCES test_sessions(id) ON DELETE SET NULL,
  specialization text NOT NULL,
  declared_grade text NOT NULL,
  result         text NOT NULL,                    -- confirmed | not_confirmed
  grade          text,
  theta          real,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sphere       text,
  description  text,
  website      text,
  contact_email text,
  contact_phone text,
  contact_telegram text,
  trust        integer NOT NULL DEFAULT 100,       -- репутация «Честного ценника»
  honest_badge boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE needs (                               -- «заказ»: описание потребности работодателя
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       text NOT NULL,
  text        text NOT NULL,
  recipe      jsonb NOT NULL,                      -- рецепт: специализация, грейд, веса ингредиентов, стек
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vacancies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  need_id        uuid REFERENCES needs(id) ON DELETE SET NULL,
  title          text NOT NULL,
  description    text NOT NULL,
  specialization text NOT NULL,
  grade          text NOT NULL,
  stacks         text[] NOT NULL DEFAULT '{}',
  formats        text[] NOT NULL DEFAULT '{remote}',
  city           text,
  salary_from    integer NOT NULL CHECK (salary_from > 0),
  salary_to      integer NOT NULL CHECK (salary_to >= salary_from),
  status         text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'closed')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (                         -- приглашение от работодателя (основная механика)
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id   uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  vacancy_id     uuid REFERENCES vacancies(id) ON DELETE SET NULL,
  need_id        uuid REFERENCES needs(id) ON DELETE SET NULL,
  task_id        uuid,
  source         text NOT NULL DEFAULT 'selection' CHECK (source IN ('selection', 'search', 'tasting')),
  title          text NOT NULL,
  description    text NOT NULL,
  salary_from    integer NOT NULL CHECK (salary_from > 0),
  salary_to      integer NOT NULL CHECK (salary_to >= salary_from),
  contact_method text NOT NULL,
  match_snapshot jsonb,                            -- объяснение подборки на момент приглашения
  status         text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'accepted', 'declined')),
  decline_reason text,
  salary_honest  boolean,                          -- «Ценник не врёт»: подтверждение кандидата после собеседования
  created_at     timestamptz NOT NULL DEFAULT now(),
  viewed_at      timestamptz,
  responded_at   timestamptz
);
CREATE INDEX invitations_candidate ON invitations (candidate_id, created_at DESC);
CREATE INDEX invitations_company ON invitations (company_id, created_at DESC);

CREATE TABLE applications (                        -- отклик кандидата на вакансию (дополнительный сценарий)
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id   uuid NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  note         text,
  status       text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  viewed_at    timestamptz,
  responded_at timestamptz,
  UNIQUE (vacancy_id, candidate_id)
);

CREATE TABLE tasks (                               -- регулярная задача «Слепая дегустация»
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  need_id        uuid REFERENCES needs(id) ON DELETE SET NULL,
  title          text NOT NULL,
  description    text NOT NULL,
  specialization text NOT NULL,
  grade          text,
  template_id    text NOT NULL,
  ops            text[] NOT NULL,
  b              real NOT NULL,
  ingredients    text[] NOT NULL,
  approach_question text,                          -- «предложите подход» (открытый ответ)
  deadline       timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  candidate_id   uuid NOT NULL REFERENCES candidates(user_id) ON DELETE CASCADE,
  variant_id     text NOT NULL,
  seed           bigint NOT NULL,
  prompt         text NOT NULL,
  code           text NOT NULL,
  language       text NOT NULL,
  options        jsonb NOT NULL,
  correct_option text NOT NULL,
  correct_label  text NOT NULL,
  answer_option  text,
  correct        boolean,
  approach       text,
  seconds        real,
  canary         jsonb,
  started_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  UNIQUE (task_id, candidate_id)
);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
