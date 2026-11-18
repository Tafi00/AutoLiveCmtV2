#!/usr/bin/env python3
"""Telegram livestream viewer worker.

Đọc tài khoản Telethon (thư mục phone/phone.session|.json|2FA.txt hoặc StringSession),
join group call của livestream rồi giữ kết nối để tăng số người xem.

Giao tiếp với Node qua stdout: mỗi dòng một JSON object.
  {"event":"ready","accounts":N}
  {"event":"joined","phone":"...","user_id":...,"name":"..."}
  {"event":"error","phone":"...","error":"..."}
  {"event":"stats","joined":N,"errors":N}
Node dừng worker bằng SIGTERM.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import signal
import string
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import unquote, urlparse

from telethon import TelegramClient, functions
from telethon.errors import FloodWaitError
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat, DataJSON

STOP = asyncio.Event()


def emit(**payload: Any) -> None:
    payload.setdefault("ts", int(time.time() * 1000))
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_account(path: str) -> Optional[dict]:
    """Chấp nhận: thư mục tài khoản, file .json (có session_str), hoặc .session."""
    if os.path.isdir(path):
        for name in os.listdir(path):
            if name.endswith(".json"):
                path = os.path.join(path, name)
                break
        else:
            return None
    if path.endswith(".json"):
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception:
            return None
        session_str = data.get("session_str")
        if not session_str:
            base = os.path.dirname(path)
            phone = str(data.get("phone") or "")
            names = [data.get("session_file"), f"{phone}.session", f"{data.get('session_file')}.session"]
            for name in names:
                if not name:
                    continue
                candidate = os.path.join(base, name)
                if os.path.exists(candidate):
                    data["_file_session"] = candidate
                    break
        data["_path"] = path
        return data
    if path.endswith(".session"):
        base = path[: -len(".session")]
        js = base + ".json"
        if os.path.exists(js):
            return load_account(js)
        return {"_file_session": path, "_path": path, "phone": os.path.basename(base)}
    return None


def parse_proxy(url: str) -> Optional[dict]:
    """http://user:pass@host:port | socks5://... -> dict proxy cho Telethon (cần python-socks)."""
    if not url:
        return None
    parsed = urlparse(url)
    scheme = (parsed.scheme or "http").lower()
    if scheme.startswith("socks5"):
        kind = "socks5"
    elif scheme.startswith("socks4"):
        kind = "socks4"
    else:
        kind = "http"
    if not parsed.hostname or not parsed.port:
        return None
    proxy = {"proxy_type": kind, "addr": parsed.hostname, "port": int(parsed.port), "rdns": True}
    if parsed.username:
        proxy["username"] = unquote(parsed.username)
    if parsed.password:
        proxy["password"] = unquote(parsed.password)
    return proxy


def load_proxy_map(path: str) -> dict:
    if not path:
        return {}
    try:
        data = json.load(open(path, encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def make_client(acc: dict) -> TelegramClient:
    app_id = int(acc.get("app_id") or 2040)
    app_hash = acc.get("app_hash") or "b18441a1ff607e10a989891a5462e627"
    device = acc.get("device") or "iPhone 14"
    sdk = acc.get("sdk") or "17.0"
    app_version = (acc.get("app_version") or "10.0.0").strip()
    lang = acc.get("lang_code") or "en"
    session = StringSession(acc["session_str"]) if acc.get("session_str") else acc.get("_file_session")
    kwargs = {}
    proxy = acc.get("_proxy")
    if proxy:
        kwargs["proxy"] = proxy
    return TelegramClient(
        session,
        app_id,
        app_hash,
        device_model=device,
        system_version=sdk,
        app_version=app_version,
        lang_code=lang,
        **kwargs,
    )


def rand_id(n: int = 12) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


async def resolve_call(client: TelegramClient, link: str):
    """Trả về (entity, InputGroupCall) của livestream/voice chat trong nhóm."""
    entity = None
    resolve_error = None
    try:
        entity = await client.get_entity(link)
    except FloodWaitError:
        raise
    except Exception as error:  # noqa: BLE001
        resolve_error = error
        # link mời dạng t.me/+hash
        if "+" in link:
            invite_hash = link.rstrip("/").split("/")[-1].lstrip("+")
            invite = await client(functions.messages.CheckChatInviteRequest(invite_hash))
            if getattr(invite, "chat", None) is not None:
                entity = invite.chat
            else:
                joined = await client(functions.messages.ImportChatInviteRequest(invite_hash))
                entity = joined.chats[0]
    if entity is None:
        detail = f": {str(resolve_error)[:160]}" if resolve_error else ""
        raise RuntimeError(f"Không mở được link livestream{detail}")
    chat = None
    try:
        if isinstance(entity, Channel):
            full = await client(functions.channels.GetFullChannelRequest(entity))
            chat = full.full_chat
        elif isinstance(entity, Chat):
            full = await client(functions.messages.GetFullChatRequest(entity.id))
            chat = full.full_chat
    except Exception as error:
        raise RuntimeError(f"Không đọc được thông tin kênh: {error}") from error
    call = getattr(chat, "call", None) if chat else None
    if call is None:
        raise RuntimeError("Nhóm/kênh không có livestream hay voice chat đang chạy")
    return entity, call


def dummy_params(ssrc: int) -> DataJSON:
    # Telegram chỉ cần tham số WebRTC hợp lệ về hình thức cho viewer muted
    payload = {
        "ufrag": rand_id(8),
        "pwd": rand_id(24),
        "fingerprints": [],
        "ssrc": ssrc,
    }
    return DataJSON(data=json.dumps(payload))


async def sleep_or_stop(seconds: float) -> bool:
    """Ngủ nhưng thức dậy ngay khi có lệnh dừng. Trả True nếu đã bị dừng."""
    # STOP được tạo trước vòng lặp asyncio nên Python 3.9 không cho await trực tiếp: ngủ từng nhịp ngắn
    deadline = time.monotonic() + max(0.0, seconds)
    while not STOP.is_set():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(0.5, remaining))
    return True


class SendPacer:
    """Giãn cách TOÀN BỘ các câu gửi đi trong đợt (mọi acc dùng chung),
    để "Nghỉ giữa các câu" đúng nghĩa thay vì nhiều acc gửi dồn cùng lúc."""

    def __init__(self, low: float, high: float):
        self.low = max(0.0, low)
        self.high = max(self.low, high)
        self.next_at = 0.0
        self.lock = asyncio.Lock()

    async def wait_turn(self) -> bool:
        async with self.lock:
            wait = self.next_at - time.monotonic()
            if await sleep_or_stop(wait):
                return False
            self.next_at = time.monotonic() + random.uniform(self.low, self.high)
            return True


async def send_comments_one(acc: dict, link: str, messages: list, per_account: int,
                           delay: tuple, pacer: "SendPacer", cursor: list, lock: asyncio.Lock) -> bool:
    phone = str(acc.get("phone") or acc.get("_path", "?"))
    client = make_client(acc)
    sent = 0
    try:
        if delay[1] > 0 and await sleep_or_stop(random.uniform(*delay)):
            return False
        if STOP.is_set():
            return False
        await connect_with_retry(client)
        if not await client.is_user_authorized():
            emit(event="error", phone=phone, error="session hết hiệu lực")
            return False
        entity = await client.get_entity(link)
        try:
            await client(functions.channels.JoinChannelRequest(channel=entity))
        except Exception:
            pass  # đã là thành viên
        for _ in range(max(1, per_account)):
            # chờ tới lượt theo nhịp chung; bị dừng thì không gửi thêm câu nào
            if not await pacer.wait_turn():
                break
            async with lock:
                # kho đã được máy chủ xoay sẵn từ câu chưa dùng; hết vòng thì quay lại đầu, giữ nguyên thứ tự
                if cursor[0] >= len(messages):
                    cursor[0] = 0
                index = cursor[0]
                text = messages[index]
                cursor[0] += 1
            try:
                await client.send_message(entity, text)
                sent += 1
                emit(event="commented", phone=phone, sent=sent, text=text[:80], index=index)
            except FloodWaitError as flood:
                emit(event="cooldown", phone=phone, seconds=int(flood.seconds), reason="floodwait")
                return sent > 0
            except Exception as error:  # noqa: BLE001
                emit(event="error", phone=phone, error=str(error)[:200])
                break
        return sent > 0
    except FloodWaitError as flood:
        emit(event="cooldown", phone=phone, seconds=int(flood.seconds), reason="floodwait")
        return False
    except Exception as error:  # noqa: BLE001
        emit(event="error", phone=phone, error=str(error)[:300])
        return False
    finally:
        try:
            await asyncio.sleep(random.uniform(0, 3))
            await client.disconnect()
        except Exception:
            pass


async def connect_with_retry(client: TelegramClient, tries: int = 3) -> None:
    # session SQLite có thể bị khoá nếu file đang mở ở tiến trình khác
    for attempt in range(tries):
        try:
            await client.connect()
            return
        except Exception as error:  # noqa: BLE001
            if "database is locked" not in str(error).lower():
                raise
            if attempt == tries - 1:
                raise RuntimeError("session đang bị mở bởi tiến trình khác (database locked) — đóng tool đang dùng acc này rồi chạy lại") from error
            await asyncio.sleep(2 + attempt * 2)


def rejoin_interval() -> float:
    return random.uniform(10.0, 18.0)


async def leave_call(client: TelegramClient, call, ssrc: int) -> None:
    try:
        await client(functions.phone.LeaveGroupCallRequest(call=call, source=ssrc))
    except Exception:
        pass


TRANSIENT_CALL_ERRORS = ("InterdcCall", "MsgidDecreaseRetry", "Timeout", "RPC_CALL_FAIL", "internal issues")


async def join_group_call(client: TelegramClient, call, join_as, ssrc: int, tries: int = 3) -> None:
    """Vào group call chỉ nghe; lỗi tạm thời phía Telegram (DC bận) thì thử lại vài lần."""
    for attempt in range(tries):
        try:
            try:
                await client(functions.phone.JoinGroupCallRequest(
                    call=call, join_as=join_as, params=dummy_params(ssrc), muted=True, video_stopped=True,
                ))
            except Exception as first_error:
                if "GROUPCALL_ALREADY_PARTICIPANT" in str(first_error):
                    return
                if any(mark in str(first_error) or mark in type(first_error).__name__ for mark in TRANSIENT_CALL_ERRORS):
                    raise
                # fallback cho bản server không nhận video_stopped
                try:
                    await client(functions.phone.JoinGroupCallRequest(
                        call=call, join_as=join_as, params=dummy_params(ssrc), muted=True,
                    ))
                except Exception:
                    raise first_error
            return
        except FloodWaitError:
            raise
        except Exception as error:  # noqa: BLE001
            transient = any(mark in str(error) or mark in type(error).__name__ for mark in TRANSIENT_CALL_ERRORS)
            if not transient or attempt == tries - 1:
                raise
            await asyncio.sleep(3 + attempt * 4 + random.uniform(0, 2))


async def join_one(acc: dict, link: str, keepalive: int, delay: float = 0.0, stop_event=None, slot=None,
                   gate=None, on_joined=None) -> bool:
    phone = str(acc.get("phone") or acc.get("_path", "?"))
    stop = stop_event or STOP
    client = make_client(acc)
    gate_held = False
    try:
        if delay > 0:
            await asyncio.sleep(delay)
        if stop.is_set():
            return False
        # gate giới hạn số acc ĐANG VÀO cùng lúc; vào xong thì nhả để acc khác vào tiếp
        if gate is not None:
            await gate.acquire()
            gate_held = True
            if stop.is_set():
                return False
        await connect_with_retry(client)
        if not await client.is_user_authorized():
            emit(event="error", phone=phone, error="session hết hiệu lực (cần đăng nhập lại)")
            return False
        me = await client.get_me()
        entity, call = await resolve_call(client, link)
        if slot is not None and not slot.get("client"):
            slot["client"] = client
            slot["call"] = call

        # tham gia group call ở chế độ chỉ nghe, không gửi media
        ssrc = random.randint(1, 2**31 - 1)
        call_params = dummy_params(ssrc)
        join_as = await client.get_input_entity("me")
        await join_group_call(client, call, join_as, ssrc)

        emit(event="joined", phone=phone, user_id=me.id, name=me.first_name or "", username=me.username or "")
        if gate_held:
            gate.release()
            gate_held = False
        if on_joined is not None:
            on_joined(phone, True)

        joined_call, joined_ssrc = call, ssrc
        while not stop.is_set():
            try:
                # Telegram tự rớt viewer không có media sau ~20-30s; vào lại định kỳ để giữ slot
                await asyncio.wait_for(stop.wait(), timeout=rejoin_interval())
                break
            except asyncio.TimeoutError:
                try:
                    await client(
                        functions.phone.JoinGroupCallRequest(
                            call=call,
                            join_as=join_as,
                            params=call_params,
                            muted=True,
                            video_stopped=True,
                        )
                    )
                except FloodWaitError as flood:
                    emit(event="cooldown", phone=phone, seconds=int(flood.seconds), reason="floodwait")
                    return False
                except Exception:
                    pass
        return True
    except FloodWaitError as flood:
        # Telegram bắt chờ: trả về số giây để Node ghi cooldown cho acc này
        emit(event="cooldown", phone=phone, seconds=int(flood.seconds), reason="floodwait")
        return False
    except Exception as error:  # noqa: BLE001
        emit(event="error", phone=phone, error=str(error)[:300])
        return False
    finally:
        if gate_held:
            gate.release()
        if on_joined is not None:
            on_joined(phone, False)
        if slot is not None and slot.get("client") is client:
            slot.pop("client", None)
            slot.pop("call", None)
        # rời phòng + đóng client, mỗi acc trễ ngẫu nhiên để không dồn cục
        try:
            if "joined_call" in locals():
                await asyncio.sleep(random.uniform(0, 4))
                await leave_call(client, joined_call, joined_ssrc)
        except Exception:
            pass
        try:
            await client.disconnect()
        except Exception:
            pass


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accounts", required=True)
    parser.add_argument("--link", required=True)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--keepalive", type=int, default=60)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--phones", default="")
    parser.add_argument("--delay-min", type=float, default=4.0)
    parser.add_argument("--delay-max", type=float, default=20.0)
    parser.add_argument("--mode", choices=["view", "comment", "check"], default="view")
    parser.add_argument("--messages", default="")
    parser.add_argument("--per-account", type=int, default=1)
    parser.add_argument("--send-delay-min", type=float, default=25.0)
    parser.add_argument("--send-delay-max", type=float, default=90.0)
    parser.add_argument("--proxies", default="")
    args = parser.parse_args()

    entries = sorted(os.listdir(args.accounts))
    wanted = {p.strip() for p in args.phones.split(",") if p.strip()}
    if wanted:
        entries = [name for name in entries if name in wanted]
    paths = [os.path.join(args.accounts, name) for name in entries]
    accounts = []
    for path in paths:
        acc = load_account(path)
        if acc:
            acc["_folder"] = os.path.basename(path)
            accounts.append(acc)
    if args.limit:
        accounts = accounts[: args.limit]
    proxy_map = load_proxy_map(args.proxies)
    if proxy_map:
        try:
            import python_socks  # noqa: F401  Telethon cần thư viện này để đi qua proxy
        except ImportError:
            emit(event="error", phone="", error="Thiếu python-socks để dùng proxy (pip install python-socks[asyncio])")
            return
        for acc in accounts:
            url = proxy_map.get(str(acc.get("phone") or "")) or proxy_map.get(acc["_folder"])
            proxy = parse_proxy(url) if url else None
            if proxy:
                acc["_proxy"] = proxy
    emit(event="ready", accounts=len(accounts))
    if not accounts:
        emit(event="error", phone="", error="Không tìm thấy tài khoản trong thư mục")
        return

    if args.mode == "check":
        await run_check(args, accounts)
    elif args.mode == "comment":
        await run_comments(args, accounts)
    else:
        await run_view(args, accounts)


async def run_check(args, accounts) -> None:
    """Kiểm tra kênh bằng một acc: loại entity, quyền gửi, livestream và số participant."""
    acc = accounts[0]
    client = make_client(acc)
    try:
        await connect_with_retry(client)
        if not await client.is_user_authorized():
            emit(event="check", ok=False, error="session hết hiệu lực")
            return
        entity = await client.get_entity(args.link)
        info = {
            "ok": True,
            "title": getattr(entity, "title", "") or getattr(entity, "username", ""),
            "username": getattr(entity, "username", "") or "",
            "type": "channel" if getattr(entity, "broadcast", False) else "group",
            "megagroup": bool(getattr(entity, "megagroup", False)),
            "id": getattr(entity, "id", None),
            "call": False,
            "participants": 0,
        }
        chat = None
        try:
            if isinstance(entity, Channel):
                full = await client(functions.channels.GetFullChannelRequest(entity))
                chat = full.full_chat
            elif isinstance(entity, Chat):
                full = await client(functions.messages.GetFullChatRequest(entity.id))
                chat = full.full_chat
        except Exception as error:  # noqa: BLE001
            info["fullError"] = str(error)[:150]
        call = getattr(chat, "call", None) if chat else None
        info["call"] = bool(call)
        if call:
            try:
                r = await client(functions.phone.GetGroupCallRequest(call=call, limit=100))
                # participants_count là con số Telegram hiển thị; danh sách participants bị lọc
                info["participants"] = int(getattr(r.call, "participants_count", 0) or len(r.participants))
            except Exception as error:  # noqa: BLE001
                info["callError"] = str(error)[:120]
        try:
            await client.send_message(entity, ".")
            info["canSend"] = True
            messages = await client.get_messages(entity, limit=1)
            if messages:
                try:
                    await messages[0].delete()
                except Exception:
                    pass
        except Exception as error:  # noqa: BLE001
            info["canSend"] = False
            info["sendError"] = str(error)[:200]
        emit(event="check", **info)
    except Exception as error:  # noqa: BLE001
        emit(event="check", ok=False, error=str(error)[:200])
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def run_comments(args, accounts) -> None:
    # stdin đóng (master chết) -> dừng ngay, không để worker mồ côi
    loop = asyncio.get_running_loop()

    def watch_stdin() -> None:
        try:
            for _ in sys.stdin:
                pass
        except Exception:
            pass
        loop.call_soon_threadsafe(STOP.set)

    import threading
    threading.Thread(target=watch_stdin, daemon=True).start()

    messages = []
    with open(args.messages, encoding="utf-8") as handle:
        messages = [line.strip() for line in handle if line.strip()]
    if not messages:
        emit(event="error", phone="", error="Kho comment rỗng")
        return
    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    cursor = [0]
    lock = asyncio.Lock()
    pacer = SendPacer(args.send_delay_min, args.send_delay_max)
    joined = 0
    errors = 0

    async def run(acc: dict) -> None:
        nonlocal joined, errors
        async with semaphore:
            if STOP.is_set():
                return
            delay = random.uniform(args.delay_min, args.delay_max)
            ok = await send_comments_one(
                acc, args.link, messages, args.per_account,
                (delay, delay), pacer, cursor, lock,
            )
            if ok:
                joined += 1
            else:
                errors += 1
            emit(event="stats", joined=joined, errors=errors)

    tasks = [asyncio.ensure_future(run(acc)) for acc in accounts]
    await asyncio.gather(*tasks, return_exceptions=True)
    emit(event="done", joined=joined, errors=errors)


async def run_view(args, accounts) -> None:
    """Chạy viewer với số mắt điều chỉnh được qua stdin: {"cmd":"set","target":N}."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def reader() -> None:
        for line in sys.stdin:
            line = line.strip()
            if line:
                loop.call_soon_threadsafe(queue.put_nowait, line)
        # stdin đóng (master chết) -> tự thoát để không giữ session
        loop.call_soon_threadsafe(queue.put_nowait, '{"cmd":"stop"}')

    import threading
    threading.Thread(target=reader, daemon=True).start()

    active: dict[str, dict] = {}
    in_room: set = set()
    slot: dict = {}
    pending = list(accounts)
    target = max(1, len(accounts) if not args.limit else min(args.limit, len(accounts)))
    errors = 0
    # chỉ giới hạn số acc đang trong bước vào phòng, không giới hạn số acc đang ngồi trong phòng
    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    refill_lock = asyncio.Lock()

    def phone_of(acc: dict) -> str:
        return str(acc.get("phone") or acc.get("_path", "?"))

    def emit_stats() -> None:
        emit(event="stats", joined=len(in_room), errors=errors, target=target, pending=len(pending))

    def mark_room(phone: str, joined: bool) -> None:
        if joined:
            in_room.add(phone)
        else:
            in_room.discard(phone)
        emit_stats()

    async def spawn(acc: dict) -> None:
        phone = phone_of(acc)
        if phone in active:
            return
        event = asyncio.Event()
        delay = random.uniform(args.delay_min, args.delay_max)

        async def runner() -> None:
            nonlocal errors
            ok = await join_one(acc, args.link, args.keepalive, delay, event, slot, gate=semaphore, on_joined=mark_room)
            dropped = not event.is_set() and not STOP.is_set()
            if not ok and dropped:
                errors += 1
            if active.get(phone, {}).get("stop") is event:
                active.pop(phone, None)
            emit_stats()
            # acc rớt/lỗi ngoài ý muốn: lấy acc dự phòng bù vào cho đủ số mắt
            if dropped:
                asyncio.ensure_future(refill())

        task = asyncio.create_task(runner())
        active[phone] = {"task": task, "stop": event}

    async def despawn(phone: str) -> None:
        info = active.pop(phone, None)
        if not info:
            return
        info["stop"].set()
        try:
            await asyncio.wait_for(info["task"], timeout=12)
        except Exception:
            info["task"].cancel()
        emit_stats()

    async def fill() -> None:
        while pending and len(active) < target and not STOP.is_set():
            await spawn(pending.pop(0))
            await asyncio.sleep(0.4)

    async def refill() -> None:
        async with refill_lock:
            await fill()

    # chờ lệnh set đầu tiên từ master (tối đa 2s) để không mở quá số mắt yêu cầu
    try:
        first = await asyncio.wait_for(queue.get(), timeout=2.0)
        try:
            cmd = json.loads(first)
            if cmd.get("cmd") == "set":
                target = max(0, min(int(cmd.get("target") or 0), len(accounts)))
            elif cmd.get("cmd") == "stop":
                STOP.set()
        except Exception:
            pass
    except asyncio.TimeoutError:
        pass

    async def monitor() -> None:
        # đọc participants_count thật từ chính client đang trong phòng
        while not STOP.is_set():
            await asyncio.sleep(20)
            client = slot.get("client")
            call = slot.get("call")
            if not client or not call:
                continue
            try:
                r = await client(functions.phone.GetGroupCallRequest(call=call, limit=100))
                count = int(getattr(r.call, "participants_count", 0) or len(r.participants))
                emit(event="participants", count=count)
            except Exception:
                pass

    monitor_task = asyncio.create_task(monitor())

    emit_stats()
    await fill()
    while not STOP.is_set():
        try:
            raw = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        try:
            command = json.loads(raw)
        except Exception:
            continue
        if command.get("cmd") == "stop":
            break
        if command.get("cmd") == "set":
            new_target = int(command.get("target") or 0)
            target = max(0, min(new_target, len(accounts)))
            if len(active) > target:
                cut = list(active)[: len(active) - target]
                stopping = []
                for phone in cut:
                    info = active.pop(phone, None)
                    if info:
                        info["stop"].set()
                        stopping.append(info["task"])
                if stopping:
                    await asyncio.gather(
                        *(asyncio.wait_for(task, timeout=12) for task in stopping),
                        return_exceptions=True,
                    )
                emit_stats()
            while pending and len(active) < target:
                await spawn(pending.pop(0))
            emit_stats()

    monitor_task.cancel()
    for info in list(active.values()):
        info["stop"].set()
    await asyncio.gather(*(info["task"] for info in active.values()), return_exceptions=True)
    emit(event="done", joined=0, errors=errors)


def handle_signal(*_args: Any) -> None:
    STOP.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
