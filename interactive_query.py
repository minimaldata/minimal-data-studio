"""Bound input-query execution without changing ordinary query sessions."""
from contextlib import contextmanager
import threading

QUERY_TIMEOUT_SECONDS = 30


@contextmanager
def input_cursor(workspace, timeout=None):
    timeout = QUERY_TIMEOUT_SECONDS if timeout is None else timeout
    if not workspace.lock.acquire(timeout=timeout):
        raise ValueError('Database is busy. Try refreshing again; previous inputs were kept.')
    cursor = None
    timer = None
    expired = threading.Event()
    try:
        cursor = workspace.connection.cursor()
        def interrupt():
            expired.set()
            cursor.interrupt()
        timer = threading.Timer(timeout, interrupt)
        timer.daemon = True
        timer.start()
        try:
            yield cursor
            if expired.is_set():
                raise TimeoutError()
        except Exception:
            if expired.is_set():
                raise ValueError(f'Input query exceeded {timeout:g} seconds. Narrow the date range or aggregate the SQL. Previous inputs were kept.') from None
            raise
    finally:
        if timer:
            timer.cancel()
            timer.join()  # Never interrupt a later operation after releasing the lock.
        if cursor:
            try: cursor.execute('ROLLBACK')
            except Exception: pass
            cursor.close()
        workspace.lock.release()
