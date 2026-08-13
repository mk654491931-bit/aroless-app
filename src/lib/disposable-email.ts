/** Bilinen geçici / tek kullanımlık e-posta sağlayıcıları. */
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "10minutemail.com","10minutemail.net","20minutemail.com","33mail.com","guerrillamail.com",
  "guerrillamail.net","guerrillamail.org","guerrillamail.biz","guerrillamailblock.com","sharklasers.com",
  "grr.la","spam4.me","mailinator.com","mailinator.net","mailinator2.com","notmailinator.com",
  "tempmail.com","temp-mail.org","temp-mail.io","tempmailo.com","tempr.email","tempmail.net",
  "tempmailaddress.com","tmpmail.org","tmpmail.net","tmpeml.com","dispostable.com","yopmail.com",
  "yopmail.fr","yopmail.net","cool.fr.nf","jetable.fr.nf","nospam.ze.tc","trashmail.com","trashmail.de",
  "trashmail.net","trash-mail.com","wegwerfmail.de","mytrashmail.com","mailnesia.com","mailnull.com",
  "getnada.com","nada.email","inboxkitten.com","emailondeck.com","fakeinbox.com","fakemailgenerator.com",
  "throwawaymail.com","maildrop.cc","mailcatch.com","moakt.com","mohmal.com","luxusmail.org",
  "burnermail.io","tempinbox.com","spambog.com","spambox.us","spamgourmet.com","mailexpire.com",
  "anonbox.net","mail-temporaire.fr","mailtemp.info","minuteinbox.com","mail7.io","mail.tm",
  "linshiyouxiang.net","tempail.com","emailfake.com","email-fake.com","1secmail.com","1secmail.net",
  "1secmail.org","dropmail.me","harakirimail.com","incognitomail.com","instant-mail.de","tmail.ws",
  "vomoto.com","zetmail.com","byom.de","discard.email","disposablemail.com","fakermail.com",
  "gettempmail.com","mailde.de","mailtothis.com","mvrht.net","tempmailer.com","yepmail.cc",
]);

/** Geçici e-posta ise true döner. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  // "sub.mailinator.com" gibi alt alan adları
  return [...DISPOSABLE_EMAIL_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}
