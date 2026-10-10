-- «Маринад»: платформа учится на собственных данных (см. docs/МАРИНАД.md)

-- Итог собеседования по принятому приглашению — сигнал для головы «Подойдёт» ранжировщика
ALTER TABLE invitations ADD COLUMN outcome text CHECK (outcome IN ('hired', 'not_fit'));
ALTER TABLE invitations ADD COLUMN outcome_at timestamptz;

-- Журнал версий моделей: что обучили, на скольких данных, включили ли (аудит и откат)
CREATE TABLE model_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('calibration', 'ranker', 'textmodel', 'drift')),
  version     text,
  activated   boolean NOT NULL DEFAULT false,
  reason      text,
  n_examples  integer,
  metrics     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_versions_kind ON model_versions (kind, created_at DESC);

-- Состояние триггеров дообучения: сколько примеров было при последнем запуске, обнулённые начинки
CREATE TABLE learning_state (
  kind        text PRIMARY KEY,
  last_count  integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  reset_keys  jsonb NOT NULL DEFAULT '{}'      -- «шаблон:начинка» → момент тревоги детектора (epoch, с)
);
