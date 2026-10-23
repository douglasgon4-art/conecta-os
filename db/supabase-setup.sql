-- Ejecutar UNA vez en el SQL Editor de Supabase (como el usuario postgres) antes de las migraciones.
-- Reemplaza las contraseñas por valores largos y aleatorios, y guárdalas en un gestor de contraseñas.

CREATE ROLE conecta_owner LOGIN PASSWORD 'CAMBIA-ESTA-CLAVE-OWNER' CREATEDB;
CREATE ROLE conecta_app   LOGIN PASSWORD 'CAMBIA-ESTA-CLAVE-APP' NOSUPERUSER NOBYPASSRLS;

-- El propietario del esquema necesita crear tablas en public.
GRANT ALL ON SCHEMA public TO conecta_owner;
GRANT CREATE ON DATABASE postgres TO conecta_owner;
-- Permite que postgres administre objetos de conecta_owner desde el panel.
GRANT conecta_owner TO postgres;

-- Bucket privado para archivos (también se puede crear desde Storage → New bucket, desmarcando "Public").
INSERT INTO storage.buckets (id, name, public) VALUES ('conecta-archivos', 'conecta-archivos', false)
ON CONFLICT (id) DO NOTHING;
