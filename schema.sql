-- Mafia Game — спрощена схема
-- Зберігаємо лише довідник ролей. Вся ігрова логіка — у Redis.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Таблиця ролей (статичні дані, не змінюються під час гри)
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(20) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description  TEXT NOT NULL,
  team         VARCHAR(10) NOT NULL CHECK (team IN ('mafia', 'town')),
  icon         VARCHAR(10) NOT NULL DEFAULT '❓',
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Відключаємо RLS для публічного читання
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view roles" ON roles FOR SELECT USING (true);

-- Початкові ролі
INSERT INTO roles (name, display_name, description, team, icon) VALUES
  ('mafia',      'Мафія',      'Вночі вбиває мешканця міста. Знає інших мафіозі.',           'mafia', '🔫'),
  ('sheriff',    'Шериф',      'Вночі перевіряє роль одного гравця.',                        'town',  '🔍'),
  ('civilian',   'Громадянин', 'Звичайний мешканець. Вдень голосує та виявляє мафію.',       'town',  '👤'),
  ('doctor',     'Лікар',      'Вночі захищає одного гравця від вбивства.',                  'town',  '💉'),
  ('prostitute', 'Повія',      'Вночі блокує дію будь-якого гравця (включно з мафією).',    'town',  '💋')
ON CONFLICT (name) DO NOTHING;
