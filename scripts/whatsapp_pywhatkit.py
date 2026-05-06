#!/usr/bin/env python3
"""
Envio de mensagens WhatsApp usando pywhatkit.

Exemplos:
  python scripts/whatsapp_pywhatkit.py --to +5511999999999 --message "Shalom, equipe!"
  python scripts/whatsapp_pywhatkit.py --to +5511999999999 --message "Lembrete de escala" --at "18:30"
"""

from __future__ import annotations

import argparse
import re
import sys

import pywhatkit


PHONE_PATTERN = re.compile(r"^\+\d{10,15}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enviar mensagem no WhatsApp com pywhatkit."
    )
    parser.add_argument(
        "--to",
        required=True,
        help="Número no formato internacional. Ex: +5511999999999",
    )
    parser.add_argument(
        "--message",
        required=True,
        help="Texto da mensagem a ser enviada.",
    )
    parser.add_argument(
        "--at",
        help="Horário HH:MM para agendar envio (24h). Ex: 18:30",
    )
    parser.add_argument(
        "--instant",
        action="store_true",
        help="Envia imediatamente (sem agendar horário). Recomendado para integração.",
    )
    parser.add_argument(
        "--wait-time",
        type=int,
        default=20,
        help="Tempo (segundos) para carregar o WhatsApp Web. Padrão: 20",
    )
    parser.add_argument(
        "--close-time",
        type=int,
        default=3,
        help="Tempo (segundos) até fechar a aba após envio. Padrão: 3",
    )
    return parser.parse_args()


def validate_phone(phone: str) -> str:
    if not PHONE_PATTERN.match(phone):
        raise ValueError(
            "Número inválido. Use o formato internacional, por exemplo: +5511999999999"
        )
    return phone


def parse_schedule(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        hh, mm = value.split(":", 1)
        hour = int(hh)
        minute = int(mm)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
        return hour, minute
    except ValueError as exc:
        raise ValueError("Horário inválido. Use o formato HH:MM (24h).") from exc


def send_now(phone: str, message: str, wait_time: int, close_time: int) -> None:
    pywhatkit.sendwhatmsg_instantly(
        phone_no=phone,
        message=message,
        wait_time=wait_time,
        tab_close=True,
        close_time=close_time,
    )


def send_scheduled(
    phone: str,
    message: str,
    hour: int,
    minute: int,
    wait_time: int,
    close_time: int,
) -> None:
    pywhatkit.sendwhatmsg(
        phone_no=phone,
        message=message,
        time_hour=hour,
        time_min=minute,
        wait_time=wait_time,
        tab_close=True,
        close_time=close_time,
    )


def main() -> int:
    args = parse_args()

    try:
        phone = validate_phone(args.to.strip())
        schedule = parse_schedule(args.at)
    except ValueError as exc:
        print(f"Erro: {exc}")
        return 2

    print("Abrindo WhatsApp Web no navegador...")
    print("Importante: mantenha o WhatsApp Web logado (QR já validado).")

    if args.instant:
        print("Envio imediato ativado.")
        send_now(phone, args.message, args.wait_time, args.close_time)
    elif schedule:
        hour, minute = schedule
        print(f"Mensagem agendada para {hour:02d}:{minute:02d}.")
        send_scheduled(phone, args.message, hour, minute, args.wait_time, args.close_time)
    else:
        print("Sem horário informado, enviando imediatamente.")
        send_now(phone, args.message, args.wait_time, args.close_time)

    print("Processo iniciado. Aguarde o envio automático na aba aberta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
