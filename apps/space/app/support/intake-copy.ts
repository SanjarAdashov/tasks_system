/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type TSupportLocale = "ru" | "uz" | "en";

export const SUPPORT_COPY = {
  ru: {
    send: "Отправить обращение", sending: "Отправляем обращение...", name: "Ваше имя", email: "Электронная почта",
    title: "Тема обращения", description: "Описание", priority: "Приоритет", files: "Файлы", filesHelp: "Перетащите файлы сюда или выберите на компьютере.",
    required: "Заполните обязательное поле", failed: "Не удалось отправить обращение. Проверьте поля и попробуйте снова.",
    codeTitle: "Форма защищена", codeHelp: "Введите код доступа, полученный от команды.", code: "Код доступа", open: "Открыть форму",
    authTitle: "Нужна авторизация", authHelp: "Эта форма доступна только активным пользователям рабочего пространства.", signIn: "Войти",
    unavailableTitle: "Форма недоступна", unavailableHelp: "Ссылка отключена, архивирована или больше не существует.",
    received: "Обращение принято", receivedHelp: "Сохраните эту страницу — здесь будут появляться статус и ответы команды.",
    reference: "Номер обращения", status: "Статус", created: "Создано", updates: "История", comments: "Переписка", addComment: "Добавить комментарий", sendComment: "Отправить",
    noComments: "Комментариев пока нет.", attachments: "Вложения", download: "Скачать", backToForm: "Новое обращение",
    attachmentComment: "Добавлено вложение", events: { SUBMITTED: "Обращение отправлено", REQUESTER_COMMENTED: "Заявитель добавил комментарий", TEAM_COMMENTED: "Команда добавила ответ", STATUS_CHANGED: "Статус изменён" },
    statuses: { RECEIVED: "Получено", UNDER_REVIEW: "На рассмотрении", IN_PROGRESS: "В работе", COMPLETED: "Завершено", REJECTED: "Отклонено" },
    priorities: { none: "Не указан", low: "Низкий", medium: "Средний", high: "Высокий", urgent: "Срочный" },
  },
  uz: {
    send: "Murojaat yuborish", sending: "Murojaat yuborilmoqda...", name: "Ismingiz", email: "Elektron pochta",
    title: "Murojaat mavzusi", description: "Tavsif", priority: "Ustuvorlik", files: "Fayllar", filesHelp: "Fayllarni shu yerga tashlang yoki kompyuterdan tanlang.",
    required: "Majburiy maydonni to‘ldiring", failed: "Murojaat yuborilmadi. Maydonlarni tekshirib, qayta urinib ko‘ring.",
    codeTitle: "Shakl himoyalangan", codeHelp: "Jamoa bergan kirish kodini kiriting.", code: "Kirish kodi", open: "Shaklni ochish",
    authTitle: "Kirish talab qilinadi", authHelp: "Bu shakl faqat ish maydonining faol foydalanuvchilari uchun ochiq.", signIn: "Kirish",
    unavailableTitle: "Shakl mavjud emas", unavailableHelp: "Havola o‘chirilgan, arxivlangan yoki endi mavjud emas.",
    received: "Murojaat qabul qilindi", receivedHelp: "Bu sahifani saqlang — holat va jamoa javoblari shu yerda ko‘rinadi.",
    reference: "Murojaat raqami", status: "Holat", created: "Yaratildi", updates: "Tarix", comments: "Yozishmalar", addComment: "Izoh qo‘shish", sendComment: "Yuborish",
    noComments: "Hozircha izohlar yo‘q.", attachments: "Ilovalar", download: "Yuklab olish", backToForm: "Yangi murojaat",
    attachmentComment: "Ilova qo‘shildi", events: { SUBMITTED: "Murojaat yuborildi", REQUESTER_COMMENTED: "Murojaatchi izoh qo‘shdi", TEAM_COMMENTED: "Jamoa javob qo‘shdi", STATUS_CHANGED: "Holat o‘zgartirildi" },
    statuses: { RECEIVED: "Qabul qilindi", UNDER_REVIEW: "Ko‘rib chiqilmoqda", IN_PROGRESS: "Ish jarayonida", COMPLETED: "Yakunlandi", REJECTED: "Rad etildi" },
    priorities: { none: "Ko‘rsatilmagan", low: "Past", medium: "O‘rta", high: "Yuqori", urgent: "Shoshilinch" },
  },
  en: {
    send: "Submit request", sending: "Submitting request...", name: "Your name", email: "Email",
    title: "Request title", description: "Description", priority: "Priority", files: "Files", filesHelp: "Drop files here or choose them from your computer.",
    required: "Complete this required field", failed: "We could not submit the request. Check the fields and try again.",
    codeTitle: "This form is protected", codeHelp: "Enter the access code shared by the team.", code: "Access code", open: "Open form",
    authTitle: "Sign in required", authHelp: "This form is available only to active users of the workspace.", signIn: "Sign in",
    unavailableTitle: "Form unavailable", unavailableHelp: "This link is disabled, archived, or no longer exists.",
    received: "Request received", receivedHelp: "Keep this page — status updates and team replies will appear here.",
    reference: "Request number", status: "Status", created: "Created", updates: "Timeline", comments: "Conversation", addComment: "Add a comment", sendComment: "Send",
    noComments: "No comments yet.", attachments: "Attachments", download: "Download", backToForm: "New request",
    attachmentComment: "Attachment added", events: { SUBMITTED: "Request submitted", REQUESTER_COMMENTED: "Requester added a comment", TEAM_COMMENTED: "Team added a reply", STATUS_CHANGED: "Status changed" },
    statuses: { RECEIVED: "Received", UNDER_REVIEW: "Under review", IN_PROGRESS: "In progress", COMPLETED: "Completed", REJECTED: "Rejected" },
    priorities: { none: "None", low: "Low", medium: "Medium", high: "High", urgent: "Urgent" },
  },
} as const;

export const getInitialSupportLocale = (): TSupportLocale => {
  if (typeof navigator === "undefined") return "ru";
  const language = navigator.language.toLowerCase();
  if (language.startsWith("uz")) return "uz";
  if (language.startsWith("en")) return "en";
  return "ru";
};

export const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};
