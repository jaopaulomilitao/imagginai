import re

from app.core.config import REPO_ROOT

MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
EXPECTED_TABLES = {
    "zones",
    "sources",
    "chunks",
    "packs",
    "jobs",
    "consents",
    "session_aggregates",
}


def _read_all_migrations() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(MIGRATIONS_DIR.glob("*.sql"))
    )


def _created_tables(sql: str) -> set[str]:
    return set(re.findall(r"create table public\.(\w+)", sql))


def test_all_section_3_11_tables_are_created() -> None:
    assert _created_tables(_read_all_migrations()) == EXPECTED_TABLES


def test_every_table_has_rls_enabled_and_an_owner_policy() -> None:
    sql = _read_all_migrations()

    for table in _created_tables(sql):
        assert f"alter table public.{table} enable row level security" in sql, table
        assert re.search(rf"create policy \w+ on public\.{table}\b", sql), table


def test_embedding_dimension_is_768() -> None:
    assert "embedding extensions.vector(768)" in _read_all_migrations()
