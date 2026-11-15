"""Read the configured database identity without renaming existing resources."""
from urllib.parse import unquote, urlsplit


def database_settings(env):
    url = urlsplit(env['DATABASE_URL'])
    database = unquote(url.path[1:])
    role = unquote(url.username or '')
    password = unquote(url.password or '')
    if not database or not role:
        raise ValueError('DATABASE_URL must include a database and username.')
    return database, role, password


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def bootstrap_sql(env):
    database, role, password = database_settings(env)
    create_database = f'CREATE DATABASE {identifier(database)} OWNER {identifier(role)}'
    return f'''DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname={literal(role)}) THEN
        CREATE ROLE {identifier(role)} LOGIN PASSWORD {literal(password)};
      END IF;
    END $$;
    SELECT {literal(create_database)} WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname={literal(database)})
\\gexec
'''
