from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

from plane.license.models import InstanceConfiguration


DEFAULT_BIRTHDAY_TEMPLATES = {
    "ru": "С днём рождения, {name}! Желаем вдохновения, ярких идей и отличного года впереди!",
    "uz": "Tug‘ilgan kuningiz bilan, {name}! Sizga ilhom, yorqin g‘oyalar va ajoyib yil tilaymiz!",
    "en": "Happy birthday, {name}! Wishing you inspiration, bright ideas, and a wonderful year ahead!",
}

BIRTHDAY_TITLES = {
    "ru": "С днём рождения!",
    "uz": "Tug‘ilgan kuningiz bilan!",
    "en": "Happy birthday!",
}


def user_language(user):
    try:
        value = user.profile.language or "en"
    except Exception:
        value = "en"
    value = str(value).lower()
    return "uz" if value.startswith("uz") else "ru" if value.startswith("ru") else "en"


def user_local_date(user, now=None):
    now = now or timezone.now()
    try:
        zone = ZoneInfo(user.user_timezone or "UTC")
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return now.astimezone(zone).date()


def birthday_date_for_year(date_of_birth, year):
    if not date_of_birth:
        return None
    try:
        return date(year, date_of_birth.month, date_of_birth.day)
    except ValueError:
        # People born on 29 February celebrate on the last day of February in
        # non-leap years so their birthday is never silently omitted.
        return date(year, 2, 28)


def is_birthday_on(user, local_date):
    return birthday_date_for_year(user.date_of_birth, local_date.year) == local_date


def birthday_template(language):
    language = language if language in DEFAULT_BIRTHDAY_TEMPLATES else "en"
    key = f"BIRTHDAY_GREETING_TEMPLATE_{language.upper()}"
    value = InstanceConfiguration.objects.filter(key=key).values_list("value", flat=True).first()
    return value or DEFAULT_BIRTHDAY_TEMPLATES[language]


def render_birthday_greeting(user, language=None):
    language = language or user_language(user)
    name = (user.first_name or user.full_name or user.email or "").strip()
    template = birthday_template(language)
    try:
        message = template.format(name=name)
    except (KeyError, ValueError):
        message = DEFAULT_BIRTHDAY_TEMPLATES[language].format(name=name)
    return {"language": language, "title": BIRTHDAY_TITLES[language], "message": message, "name": name}
