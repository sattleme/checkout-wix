// The plugin's texts, in the languages of the sattle.me app: English the source, written first in
// each entry, and its translations. Wix has no translation mechanism for backend code: the
// merchant's texts (connection, refusals, order comments, notifications, status page) follow the
// site's language (its dashboard's General Info); the customer's payment page follows the order's
// (Wix's buyer language), else the one the browser asks for. Placeholders: {name}.

export const LANGUAGES = ["en", "fr", "de", "it"];

/** The one of LANGUAGES of a language code ("fr", "fr-CH", "de_CH"…), or null for any other. */
export function languageOf(code) {
  if (typeof code !== "string") return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.indexOf(base) === -1 ? null : base;
}

/** One of LANGUAGES for a language code ("fr", "fr-CH", "de_CH"…): English by default. */
export function pickLanguage(code) {
  return languageOf(code) || "en";
}

/** The language of an Accept-Language header the plugin has, or English. */
export function acceptedLanguage(header) {
  if (typeof header !== "string") return "en";
  for (const part of header.split(",").slice(0, 10)) {
    const code = part.split(";")[0].trim().toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.indexOf(code) !== -1) return code;
  }
  return "en";
}

const TEXTS = {
  // createTransaction's refusals (errorMessage), for the merchant.
  "refusal.unsupported_currency": {
    en: "No bitcoin rate source has a price in {currency}: payment refused.",
    fr: "Aucune source de cours du bitcoin n'a de prix en {currency} : paiement refusé.",
    de: "Keine Bitcoin-Kursquelle hat einen Preis in {currency}: Zahlung abgelehnt.",
    it: "Nessuna fonte del cambio del bitcoin ha un prezzo in {currency}: pagamento rifiutato."
  },
  "refusal.bounds": {
    en: "Amount outside the business's sattle.me limits: payment refused.",
    fr: "Montant hors des limites sattle.me du commerce : paiement refusé.",
    de: "Betrag ausserhalb der sattle.me-Grenzen des Geschäfts: Zahlung abgelehnt.",
    it: "Importo fuori dai limiti sattle.me dell'attività: pagamento rifiutato."
  },
  "refusal.onchain_unavailable": {
    en: "This amount can only be paid on-chain and no deposit address is free: open the sattle.me app to refill the lot of addresses.",
    fr: "Ce montant ne se paie qu'on-chain et aucune adresse de dépôt n'est libre : ouvrez l'app sattle.me pour remplir le lot d'adresses.",
    de: "Dieser Betrag ist nur on-chain zahlbar und keine Einzahlungsadresse ist frei: Öffnen Sie die sattle.me-App, um den Adressvorrat aufzufüllen.",
    it: "Questo importo si paga solo on-chain e nessun indirizzo di deposito è libero: apra l'app sattle.me per ricaricare il lotto di indirizzi."
  },
  "refusal.revoked": {
    en: "The integration was removed in the sattle.me app: create another one and save its key.",
    fr: "L'intégration a été supprimée dans l'app sattle.me : créez-en une autre et enregistrez sa clé.",
    de: "Die Integration wurde in der sattle.me-App entfernt: Erstellen Sie eine neue und speichern Sie ihren Schlüssel.",
    it: "L'integrazione è stata rimossa nell'app sattle.me: ne crei un'altra e salvi la sua chiave."
  },
  "refusal.invalid_key": {
    en: "The sattleme-checkout-key secret of the Secrets Manager is not a sattle.me integration key.",
    fr: "Le secret sattleme-checkout-key du Secrets Manager n'est pas une clé d'intégration sattle.me.",
    de: "Das Secret sattleme-checkout-key im Secrets Manager ist kein sattle.me-Integrationsschlüssel.",
    it: "Il segreto sattleme-checkout-key del Secrets Manager non è una chiave di integrazione sattle.me."
  },
  "refusal.no_key": {
    en: "No key in the Secrets Manager: save the integration's key as sattleme-checkout-key.",
    fr: "Aucune clé dans le Secrets Manager : enregistrez la clé de l'intégration sous le nom sattleme-checkout-key.",
    de: "Kein Schlüssel im Secrets Manager: Speichern Sie den Schlüssel der Integration als sattleme-checkout-key.",
    it: "Nessuna chiave nel Secrets Manager: salvi la chiave dell'integrazione come sattleme-checkout-key."
  },
  "refusal.no_site": {
    en: "The plugin does not know this site's address yet: open its status page once (/_functions/sattlemeCheckoutStatus). Payment refused.",
    fr: "Le plugin ne connaît pas encore l'adresse de ce site : ouvrez une fois sa page d'état (/_functions/sattlemeCheckoutStatus). Paiement refusé.",
    de: "Das Plugin kennt die Adresse dieser Website noch nicht: Öffnen Sie einmal seine Statusseite (/_functions/sattlemeCheckoutStatus). Zahlung abgelehnt.",
    it: "Il plugin non conosce ancora l'indirizzo di questo sito: apra una volta la sua pagina di stato (/_functions/sattlemeCheckoutStatus). Pagamento rifiutato."
  },
  "refusal.channel_not_found": {
    en: "The business's relays did not answer with its integration: try again.",
    fr: "Les relais du commerce n'ont pas répondu avec son intégration : réessayez.",
    de: "Die Relays des Geschäfts haben nicht mit seiner Integration geantwortet: Versuchen Sie es erneut.",
    it: "I relay dell'attività non hanno risposto con la sua integrazione: riprovi."
  },
  "refusal.newer_format": {
    en: "The sattle.me app uses a newer format than this plugin: update the plugin.",
    fr: "L'app sattle.me utilise un format plus récent que ce plugin : mettez le plugin à jour.",
    de: "Die sattle.me-App verwendet ein neueres Format als dieses Plugin: Aktualisieren Sie das Plugin.",
    it: "L'app sattle.me usa un formato più recente di questo plugin: aggiorni il plugin."
  },
  "refusal.network": {
    en: "The business's relays or payment services did not answer in time: try again.",
    fr: "Les relais ou les services de paiement du commerce n'ont pas répondu à temps : réessayez.",
    de: "Die Relays oder Zahlungsdienste des Geschäfts haben nicht rechtzeitig geantwortet: Versuchen Sie es erneut.",
    it: "I relay o i servizi di pagamento dell'attività non hanno risposto in tempo: riprovi."
  },
  "refusal.rate": {
    en: "No usable bitcoin rate right now: try again.",
    fr: "Aucun cours du bitcoin utilisable pour le moment : réessayez.",
    de: "Derzeit kein verwendbarer Bitcoin-Kurs: Versuchen Sie es erneut.",
    it: "Nessun cambio del bitcoin utilizzabile al momento: riprovi."
  },
  "refusal.deadline": {
    en: "The invoice could not be created in time: try again.",
    fr: "La facture n'a pas pu être créée à temps : réessayez.",
    de: "Die Rechnung konnte nicht rechtzeitig erstellt werden: Versuchen Sie es erneut.",
    it: "La fattura non è stata creata in tempo: riprovi."
  },
  "refusal.busy": {
    en: "Another payment request of this order is under way: try again.",
    fr: "Une autre demande de paiement de cette commande est en cours : réessayez.",
    de: "Eine andere Zahlungsanfrage dieser Bestellung läuft bereits: Versuchen Sie es erneut.",
    it: "Un'altra richiesta di pagamento di questo ordine è in corso: riprovi."
  },
  "refusal.invalid_invoice": {
    en: "The invoice received failed the checks: payment refused.",
    fr: "La facture reçue n'a pas passé les contrôles : paiement refusé.",
    de: "Die erhaltene Rechnung hat die Prüfungen nicht bestanden: Zahlung abgelehnt.",
    it: "La fattura ricevuta non ha superato i controlli: pagamento rifiutato."
  },
  "refusal.currency": {
    en: "{currency} is not one of the currencies sattle.me prices in: payment refused.",
    fr: "La devise {currency} n'est pas l'une de celles où sattle.me facture : paiement refusé.",
    de: "{currency} gehört nicht zu den Währungen, in denen sattle.me abrechnet: Zahlung abgelehnt.",
    it: "{currency} non è una delle valute in cui sattle.me fattura: pagamento rifiutato."
  },
  "refusal.amount": {
    en: "Invalid amount: payment refused.",
    fr: "Montant invalide : paiement refusé.",
    de: "Ungültiger Betrag: Zahlung abgelehnt.",
    it: "Importo non valido: pagamento rifiutato."
  },
  "refusal.precision": {
    en: "This amount has more decimals than sattle.me gives {currency}: payment refused, never rounded.",
    fr: "Ce montant a plus de décimales que sattle.me n'en donne à {currency} : paiement refusé, jamais arrondi.",
    de: "Dieser Betrag hat mehr Dezimalstellen, als sattle.me für {currency} vorsieht: Zahlung abgelehnt, nie gerundet.",
    it: "Questo importo ha più decimali di quanti sattle.me ne dia a {currency}: pagamento rifiutato, mai arrotondato."
  },
  "refusal.paid": {
    en: "This order is paid already: new payment refused.",
    fr: "Cette commande est déjà payée : nouveau paiement refusé.",
    de: "Diese Bestellung ist bereits bezahlt: neue Zahlung abgelehnt.",
    it: "Questo ordine è già pagato: nuovo pagamento rifiutato."
  },
  "refusal.attention": {
    en: "The payment of this order waits for the merchant (see the order's comment): new payment refused.",
    fr: "Le paiement de cette commande attend une action du marchand (voir le commentaire de la commande) : nouveau paiement refusé.",
    de: "Die Zahlung dieser Bestellung wartet auf den Händler (siehe Kommentar der Bestellung): neue Zahlung abgelehnt.",
    it: "Il pagamento di questo ordine attende un intervento del commerciante (veda il commento dell'ordine): nuovo pagamento rifiutato."
  },
  "refusal.unexpected": {
    en: "Unexpected error: payment refused.",
    fr: "Erreur inattendue : paiement refusé.",
    de: "Unerwarteter Fehler: Zahlung abgelehnt.",
    it: "Errore imprevisto: pagamento rifiutato."
  },

  // connectAccount, for the merchant.
  "connect.accountName": {
    en: "{business} · {min} to {max} sats · {addresses} on-chain addresses",
    fr: "{business} · {min} à {max} sats · {addresses} adresses on-chain",
    de: "{business} · {min} bis {max} Sats · {addresses} On-Chain-Adressen",
    it: "{business} · da {min} a {max} sats · {addresses} indirizzi on-chain"
  },
  "connect.accountName.one": {
    en: "{business} · {min} to {max} sats · {addresses} on-chain address",
    fr: "{business} · {min} à {max} sats · {addresses} adresse on-chain",
    de: "{business} · {min} bis {max} Sats · {addresses} On-Chain-Adresse",
    it: "{business} · da {min} a {max} sats · {addresses} indirizzo on-chain"
  },
  "connect.currency": {
    en: "The site's currency ({currency}) is not one of the currencies sattle.me prices in.",
    fr: "La devise du site ({currency}) n'est pas l'une de celles où sattle.me facture.",
    de: "Die Währung der Website ({currency}) gehört nicht zu den Währungen, in denen sattle.me abrechnet.",
    it: "La valuta del sito ({currency}) non è una delle valute in cui sattle.me fattura."
  },
  "connect.no_key": {
    en: "First save the integration's key in the Secrets Manager, as sattleme-checkout-key, then connect again.",
    fr: "Enregistrez d'abord la clé de l'intégration dans le Secrets Manager, sous le nom sattleme-checkout-key, puis reconnectez.",
    de: "Speichern Sie zuerst den Schlüssel der Integration im Secrets Manager als sattleme-checkout-key und verbinden Sie dann erneut.",
    it: "Salvi prima la chiave dell'integrazione nel Secrets Manager, come sattleme-checkout-key, poi si colleghi di nuovo."
  },
  "connect.invalid_key": {
    en: "The sattleme-checkout-key secret is not a sattle.me integration key (sattleme_ck_…).",
    fr: "Le secret sattleme-checkout-key n'est pas une clé d'intégration sattle.me (sattleme_ck_…).",
    de: "Das Secret sattleme-checkout-key ist kein sattle.me-Integrationsschlüssel (sattleme_ck_…).",
    it: "Il segreto sattleme-checkout-key non è una chiave di integrazione sattle.me (sattleme_ck_…)."
  },
  "connect.revoked": {
    en: "This integration was removed in the sattle.me app: create another one and save its key.",
    fr: "Cette intégration a été supprimée dans l'app sattle.me : créez-en une autre et enregistrez sa clé.",
    de: "Diese Integration wurde in der sattle.me-App entfernt: Erstellen Sie eine neue und speichern Sie ihren Schlüssel.",
    it: "Questa integrazione è stata rimossa nell'app sattle.me: ne crei un'altra e salvi la sua chiave."
  },
  "connect.newer_format": {
    en: "The sattle.me app uses a newer format than this plugin: update the plugin.",
    fr: "L'app sattle.me utilise un format plus récent que ce plugin : mettez le plugin à jour.",
    de: "Die sattle.me-App verwendet ein neueres Format als dieses Plugin: Aktualisieren Sie das Plugin.",
    it: "L'app sattle.me usa un formato più recente di questo plugin: aggiorni il plugin."
  },
  "connect.channel_not_found": {
    en: "The business's relays did not answer with its integration: try again in a moment.",
    fr: "Les relais du commerce n'ont pas répondu avec son intégration : réessayez dans un instant.",
    de: "Die Relays des Geschäfts haben nicht mit seiner Integration geantwortet: Versuchen Sie es gleich noch einmal.",
    it: "I relay dell'attività non hanno risposto con la sua integrazione: riprovi tra un momento."
  },
  "connect.network": {
    en: "The business's relays or payment services did not answer in time: try again.",
    fr: "Les relais ou les services de paiement du commerce n'ont pas répondu à temps : réessayez.",
    de: "Die Relays oder Zahlungsdienste des Geschäfts haben nicht rechtzeitig geantwortet: Versuchen Sie es erneut.",
    it: "I relay o i servizi di pagamento dell'attività non hanno risposto in tempo: riprovi."
  },
  "connect.deadline": {
    en: "The business's relays or payment services did not answer in time: try again.",
    fr: "Les relais ou les services de paiement du commerce n'ont pas répondu à temps : réessayez.",
    de: "Die Relays oder Zahlungsdienste des Geschäfts haben nicht rechtzeitig geantwortet: Versuchen Sie es erneut.",
    it: "I relay o i servizi di pagamento dell'attività non hanno risposto in tempo: riprovi."
  },
  "connect.unexpected": {
    en: "Unexpected error: try again.",
    fr: "Erreur inattendue : réessayez.",
    de: "Unerwarteter Fehler: Versuchen Sie es erneut.",
    it: "Errore imprevisto: riprovi."
  },
  "connect.secretName": {
    en: "Type sattleme-checkout-key in the field: the name of the Secrets Manager's secret that holds the integration key.",
    fr: "Tapez sattleme-checkout-key dans le champ : le nom du secret du Secrets Manager qui contient la clé d'intégration.",
    de: "Geben Sie sattleme-checkout-key in das Feld ein: den Namen des Secrets im Secrets Manager, das den Integrationsschlüssel enthält.",
    it: "Digiti sattleme-checkout-key nel campo: il nome del segreto del Secrets Manager che contiene la chiave di integrazione."
  },
  "connect.keyTyped": {
    en: "Never type the key here. Save it in the Secrets Manager as sattleme-checkout-key, type that name here, and replace this integration in the sattle.me app: its key was typed elsewhere.",
    fr: "Ne tapez jamais la clé ici. Enregistrez-la dans le Secrets Manager sous le nom sattleme-checkout-key, tapez ce nom ici, et remplacez cette intégration dans l'app sattle.me : sa clé a été saisie ailleurs.",
    de: "Geben Sie den Schlüssel nie hier ein. Speichern Sie ihn im Secrets Manager als sattleme-checkout-key, geben Sie diesen Namen hier ein und ersetzen Sie diese Integration in der sattle.me-App: Ihr Schlüssel wurde anderswo eingegeben.",
    it: "Non digiti mai la chiave qui. La salvi nel Secrets Manager come sattleme-checkout-key, digiti qui quel nome e sostituisca questa integrazione nell'app sattle.me: la sua chiave è stata digitata altrove."
  },
  "connect.minutes": {
    en: "The time to pay is a whole number of minutes, from 1 to 60 (empty: 15).",
    fr: "Le délai de paiement est un nombre entier de minutes, de 1 à 60 (vide : 15).",
    de: "Die Zahlungsfrist ist eine ganze Zahl von Minuten, von 1 bis 60 (leer: 15).",
    it: "Il tempo per pagare è un numero intero di minuti, da 1 a 60 (vuoto: 15)."
  },

  // The order's comment, for the merchant.
  "connect.noSite": {
    en: "First open the plugin's status page once (https://<your site>/_functions/sattlemeCheckoutStatus): it keeps the site's address, which the payment page needs. Then connect again.",
    fr: "Ouvrez d'abord une fois la page d'état du plugin (https://<votre site>/_functions/sattlemeCheckoutStatus) : elle garde l'adresse du site, dont la page de paiement a besoin. Puis connectez à nouveau.",
    de: "Öffnen Sie zuerst einmal die Statusseite des Plugins (https://<Ihre Website>/_functions/sattlemeCheckoutStatus): Sie speichert die Adresse der Website, die die Zahlungsseite braucht. Verbinden Sie dann erneut.",
    it: "Apra prima una volta la pagina di stato del plugin (https://<il suo sito>/_functions/sattlemeCheckoutStatus): conserva l'indirizzo del sito, di cui la pagina di pagamento ha bisogno. Poi si connetta di nuovo."
  },
  "report.paid": {
    en: "sattle.me: paid.",
    fr: "sattle.me : payée.",
    de: "sattle.me: bezahlt.",
    it: "sattle.me: pagato."
  },
  "report.underpaid": {
    en: "sattle.me: underpaid, then the invoice expired. Received {received} of {due} sats (on-chain to the deposit address {address}, and in Lightning by any invoice of the rest that was paid). This money is in your wallet: settle with the customer from your sattle.me app. The order stays pending.",
    fr: "sattle.me : paiement insuffisant, puis facture expirée. Reçu {received} sats sur {due} sats (on-chain à l'adresse de dépôt {address}, et en Lightning par toute facture du reste qui a été payée). Cet argent est sur votre portefeuille : réglez avec le client depuis votre app sattle.me. La commande reste en attente.",
    de: "sattle.me: zu wenig bezahlt, dann ist die Rechnung abgelaufen. Erhalten: {received} von {due} Sats (on-chain an die Einzahlungsadresse {address} und per Lightning durch jede bezahlte Rechnung des Rests). Dieses Geld ist in Ihrer Wallet: Regeln Sie es mit dem Kunden über Ihre sattle.me-App. Die Bestellung bleibt ausstehend.",
    it: "sattle.me: pagamento insufficiente, poi la fattura è scaduta. Ricevuti {received} sats su {due} sats (on-chain all'indirizzo di deposito {address}, e in Lightning da ogni fattura del resto che è stata pagata). Questo denaro è nel suo portafoglio: regoli la questione con il cliente dalla sua app sattle.me. L'ordine resta in sospeso."
  },
  "report.canceled": {
    en: "sattle.me: the invoice of this order, canceled, was paid. The order is not reopened: settle with the customer from your sattle.me app, or restore the order.",
    fr: "sattle.me : la facture de cette commande, annulée, a été payée. La commande n'est pas rouverte : réglez avec le client depuis votre app sattle.me, ou rétablissez la commande.",
    de: "sattle.me: Die Rechnung dieser stornierten Bestellung wurde bezahlt. Die Bestellung wird nicht wieder geöffnet: Regeln Sie es mit dem Kunden über Ihre sattle.me-App oder stellen Sie die Bestellung wieder her.",
    it: "sattle.me: la fattura di questo ordine annullato è stata pagata. L'ordine non viene riaperto: regoli la questione con il cliente dalla sua app sattle.me, o ripristini l'ordine."
  },
  "report.mismatch": {
    en: "sattle.me: the invoice of this order is of {invoicePrice}, not {price}. The order is not marked paid: check it in your sattle.me app.",
    fr: "sattle.me : la facture de cette commande est de {invoicePrice}, pas de {price}. La commande n'est pas marquée payée : vérifiez-la dans votre app sattle.me.",
    de: "sattle.me: Die Rechnung dieser Bestellung lautet auf {invoicePrice}, nicht auf {price}. Die Bestellung wird nicht als bezahlt markiert: Prüfen Sie sie in Ihrer sattle.me-App.",
    it: "sattle.me: la fattura di questo ordine è di {invoicePrice}, non di {price}. L'ordine non è segnato come pagato: lo verifichi nella sua app sattle.me."
  },
  "report.stale": {
    en: "sattle.me: the payment of this order is still not final 90 days after its invoice's end. Check it in your sattle.me app.",
    fr: "sattle.me : le paiement de cette commande n'est toujours pas définitif 90 jours après la fin de sa facture. Vérifiez-le dans votre app sattle.me.",
    de: "sattle.me: Die Zahlung dieser Bestellung ist 90 Tage nach Ablauf ihrer Rechnung immer noch nicht endgültig. Prüfen Sie sie in Ihrer sattle.me-App.",
    it: "sattle.me: il pagamento di questo ordine non è ancora definitivo 90 giorni dopo la fine della sua fattura. Lo verifichi nella sua app sattle.me."
  },
  "report.unrecorded": {
    en: "sattle.me: paid, but Wix did not record the payment: Wix shows this order as not paid and does not list it. The proof is below, and the sale is in your sattle.me app: deliver the order, or settle with the customer.",
    fr: "sattle.me : payée, mais Wix n'a pas enregistré le paiement : Wix affiche cette commande comme non payée et ne la liste pas. La preuve est ci-dessous, et la vente est dans votre app sattle.me : livrez la commande, ou réglez avec le client.",
    de: "sattle.me: bezahlt, aber Wix hat die Zahlung nicht erfasst: Wix zeigt diese Bestellung als nicht bezahlt an und listet sie nicht. Der Nachweis steht unten, und der Verkauf ist in Ihrer sattle.me-App: Liefern Sie die Bestellung aus oder regeln Sie es mit dem Kunden.",
    it: "sattle.me: pagato, ma Wix non ha registrato il pagamento: Wix mostra questo ordine come non pagato e non lo elenca. La prova è qui sotto, e la vendita è nella sua app sattle.me: consegni l'ordine, o regoli la questione con il cliente."
  },
  "report.changed": {
    en: "sattle.me: paid ({came} sats received for the invoice's {sats} sats, {price}), but the order's total is now {total}: it changed after the invoice was made. The order is not marked paid: settle the difference with the customer (your sattle.me app refunds), then complete the order by hand.",
    fr: "sattle.me : payée ({came} sats reçus pour les {sats} sats de la facture, {price}), mais le total de la commande est maintenant de {total} : il a changé après la création de la facture. La commande n'est pas marquée payée : réglez la différence avec le client (votre app sattle.me rembourse), puis complétez la commande à la main.",
    de: "sattle.me: bezahlt ({came} Sats erhalten für die {sats} Sats der Rechnung, {price}), aber die Bestellung beträgt jetzt {total}: Sie wurde nach der Rechnung geändert. Die Bestellung wird nicht als bezahlt markiert: Regeln Sie die Differenz mit dem Kunden (Ihre sattle.me-App erstattet zurück) und schliessen Sie die Bestellung dann von Hand ab.",
    it: "sattle.me: pagato ({came} sats ricevuti per i {sats} sats della fattura, {price}), ma il totale dell'ordine è ora di {total}: è cambiato dopo la creazione della fattura. L'ordine non è segnato come pagato: regoli la differenza con il cliente (la sua app sattle.me rimborsa), poi completi l'ordine a mano."
  },
  "report.method": {
    en: "Method: {method}",
    fr: "Méthode : {method}",
    de: "Methode: {method}",
    it: "Metodo: {method}"
  },
  "report.amount": {
    en: "Amount: {sats} sats, for {price}.",
    fr: "Montant : {sats} sats, pour {price}.",
    de: "Betrag: {sats} Sats, für {price}.",
    it: "Importo: {sats} sats, per {price}."
  },
  "report.rate": {
    en: "Rate: 1 bitcoin = {rate} {currency} ({source}).",
    fr: "Cours : 1 bitcoin = {rate} {currency} ({source}).",
    de: "Kurs: 1 Bitcoin = {rate} {currency} ({source}).",
    it: "Cambio: 1 bitcoin = {rate} {currency} ({source})."
  },
  "report.address": {
    en: "Deposit address: {address}",
    fr: "Adresse de dépôt : {address}",
    de: "Einzahlungsadresse: {address}",
    it: "Indirizzo di deposito: {address}"
  },
  "report.preimage": {
    en: "Preimage (proof of the Lightning payment)",
    fr: "Preimage (preuve du paiement Lightning)",
    de: "Preimage (Nachweis der Lightning-Zahlung)",
    it: "Preimage (prova del pagamento Lightning)"
  },
  "report.preimages": {
    en: "Preimages (proofs of the Lightning payments)",
    fr: "Preimages (preuves des paiements Lightning)",
    de: "Preimages (Nachweise der Lightning-Zahlungen)",
    it: "Preimage (prove dei pagamenti Lightning)"
  },
  "report.txids": {
    en: "Transactions",
    fr: "Transactions",
    de: "Transaktionen",
    it: "Transazioni"
  },
  "report.received": {
    en: "Received: {received} sats",
    fr: "Reçu : {received} sats",
    de: "Erhalten: {received} Sats",
    it: "Ricevuti: {received} sats"
  },
  "report.accepted": {
    en: "Received {received} of {due} sats: accepted by the business in its sattle.me app (its tolerance, or by hand).",
    fr: "Reçu {received} sats sur {due} : accepté par le commerce dans son app sattle.me (sa tolérance, ou à la main).",
    de: "{received} von {due} Sats erhalten: vom Geschäft in seiner sattle.me-App akzeptiert (seine Toleranz oder von Hand).",
    it: "Ricevuti {received} sats su {due}: accettato dall'attività nella sua app sattle.me (la sua tolleranza, o a mano)."
  },
  "report.erased": {
    en: "The customer's Wix contact was deleted: at the customer's request, this payment's deposit address, transactions, Lightning invoice and wallet link were erased, with the contact's id; none is in this note. Its payment page shows only the order's state.",
    fr: "Le contact Wix du client a été supprimé : à la demande du client, l'adresse de dépôt, les transactions, la facture Lightning et le lien vers le portefeuille de ce paiement ont été effacés, avec l'identifiant du contact ; aucun ne figure dans cette note. Sa page de paiement ne montre que l'état de la commande.",
    de: "Der Wix-Kontakt des Kunden wurde gelöscht: Auf Wunsch des Kunden wurden Einzahlungsadresse, Transaktionen, Lightning-Rechnung und Wallet-Link dieser Zahlung gelöscht, mit der Kennung des Kontakts; nichts davon steht in dieser Notiz. Ihre Zahlungsseite zeigt nur den Stand der Bestellung.",
    it: "Il contatto Wix del cliente è stato eliminato: su richiesta del cliente, l'indirizzo di deposito, le transazioni, la fattura Lightning e il link al portafoglio di questo pagamento sono stati cancellati, con l'identificativo del contatto; nessuno è in questa nota. La sua pagina di pagamento mostra solo lo stato dell'ordine."
  },
  "report.erasedValue": {
    en: "(erased at the customer's request)",
    fr: "(effacée à la demande du client)",
    de: "(auf Wunsch des Kunden gelöscht)",
    it: "(cancellato su richiesta del cliente)"
  },
  "report.receivedOf": {
    en: "Received {received} of {due} sats.",
    fr: "Reçu {received} sats sur {due}.",
    de: "{received} von {due} Sats erhalten.",
    it: "Ricevuti {received} sats su {due}."
  },
  "report.ref": {
    en: "sattle.me reference: {ref}",
    fr: "Référence sattle.me : {ref}",
    de: "sattle.me-Referenz: {ref}",
    it: "Riferimento sattle.me: {ref}"
  },

  // The merchant's task: its description's line of the order, then its title, which Wix's
  // dashboard shows alone.
  "task.order": {
    en: "Wix order: {orderId} (not in the list of orders until it is paid).",
    fr: "Commande Wix : {orderId} (absente de la liste des commandes tant qu'elle n'est pas payée).",
    de: "Wix-Bestellung: {orderId} (nicht in der Bestellliste, solange sie nicht bezahlt ist).",
    it: "Ordine Wix: {orderId} (assente dall'elenco degli ordini finché non è pagato)."
  },
  "task.underpaid": {
    en: "Order {number}: {received} of {due} sats received, invoice expired. Settle with the customer from your sattle.me app (details: the plugin's status page).",
    fr: "Commande {number} : {received} sats reçus sur {due}, facture expirée. Réglez avec le client depuis votre app sattle.me (détails : page d'état du plugin).",
    de: "Bestellung {number}: {received} von {due} Sats erhalten, Rechnung abgelaufen. Regeln Sie es mit dem Kunden über Ihre sattle.me-App (Details: Statusseite des Plugins).",
    it: "Ordine {number}: ricevuti {received} sats su {due}, fattura scaduta. Regoli la questione con il cliente dalla sua app sattle.me (dettagli: pagina di stato del plugin)."
  },
  "task.canceled": {
    en: "Order {number}: paid after it was canceled. Settle with the customer from your sattle.me app, or restore the order (details: the plugin's status page).",
    fr: "Commande {number} : payée après son annulation. Réglez avec le client depuis votre app sattle.me, ou rétablissez la commande (détails : page d'état du plugin).",
    de: "Bestellung {number}: nach der Stornierung bezahlt. Regeln Sie es mit dem Kunden über Ihre sattle.me-App oder stellen Sie die Bestellung wieder her (Details: Statusseite des Plugins).",
    it: "Ordine {number}: pagato dopo il suo annullamento. Regoli la questione con il cliente dalla sua app sattle.me, o ripristini l'ordine (dettagli: pagina di stato del plugin)."
  },
  "task.mismatch": {
    en: "Order {number}: invoice of {invoicePrice} instead of {price}, not marked paid. Check it in your sattle.me app (details: the plugin's status page).",
    fr: "Commande {number} : facture de {invoicePrice} au lieu de {price}, non marquée payée. Vérifiez-la dans votre app sattle.me (détails : page d'état du plugin).",
    de: "Bestellung {number}: Rechnung über {invoicePrice} statt {price}, nicht als bezahlt markiert. Prüfen Sie sie in Ihrer sattle.me-App (Details: Statusseite des Plugins).",
    it: "Ordine {number}: fattura di {invoicePrice} invece di {price}, non segnato come pagato. Lo verifichi nella sua app sattle.me (dettagli: pagina di stato del plugin)."
  },
  "task.changed": {
    en: "Order {number}: paid {came} of {sats} sats ({price}), total now {total}. Settle the difference with the customer, then complete it (details: the plugin's status page).",
    fr: "Commande {number} : payée {came} sur {sats} sats ({price}), total désormais {total}. Réglez la différence avec le client, puis complétez-la (détails : page d'état du plugin).",
    de: "Bestellung {number}: {came} von {sats} Sats bezahlt ({price}), jetzt {total}. Differenz mit dem Kunden regeln, dann abschliessen (Details: Statusseite des Plugins).",
    it: "Ordine {number}: pagati {came} di {sats} sats ({price}), totale ora {total}. Regoli la differenza con il cliente, poi lo completi (dettagli: pagina di stato del plugin)."
  },
  "task.stale": {
    en: "Order {number}: payment not final 90 days after its invoice. Check it in your sattle.me app (details: the plugin's status page).",
    fr: "Commande {number} : paiement non définitif 90 jours après sa facture. Vérifiez-le dans votre app sattle.me (détails : page d'état du plugin).",
    de: "Bestellung {number}: Zahlung 90 Tage nach ihrer Rechnung nicht endgültig. Prüfen Sie sie in Ihrer sattle.me-App (Details: Statusseite des Plugins).",
    it: "Ordine {number}: pagamento non definitivo 90 giorni dopo la sua fattura. Lo verifichi nella sua app sattle.me (dettagli: pagina di stato del plugin)."
  },
  "task.unrecorded": {
    en: "Order {number}: paid, but Wix did not record the payment. Deliver the order, or settle with the customer from your sattle.me app (details: the plugin's status page).",
    fr: "Commande {number} : payée, mais Wix n'a pas enregistré le paiement. Livrez la commande, ou réglez avec le client depuis votre app sattle.me (détails : page d'état du plugin).",
    de: "Bestellung {number}: bezahlt, aber Wix hat die Zahlung nicht erfasst. Liefern Sie sie aus oder regeln Sie es mit dem Kunden über Ihre sattle.me-App (Details: Statusseite des Plugins).",
    it: "Ordine {number}: pagato, ma Wix non ha registrato il pagamento. Consegni l'ordine, o regoli la questione con il cliente dalla sua app sattle.me (dettagli: pagina di stato del plugin)."
  },

  // The site owner's notification.
  "notice.title": {
    en: "Bitcoin payment needs you",
    fr: "Paiement Bitcoin à traiter",
    de: "Bitcoin-Zahlung zu bearbeiten",
    it: "Pagamento Bitcoin da gestire"
  },
  "notice.open": {
    en: "Open the status page",
    fr: "Ouvrir la page d'état",
    de: "Statusseite öffnen",
    it: "Apri la pagina di stato"
  },
  "notice.details": {
    en: "Details in the dashboard's task and on the status page.",
    fr: "Détails dans la tâche du tableau de bord et sur la page d'état.",
    de: "Details in der Aufgabe im Dashboard und auf der Statusseite.",
    it: "Dettagli nell'attività del pannello di controllo e nella pagina di stato."
  },
  "notice.underpaid": {
    en: "Order {number}: underpaid, invoice expired.",
    fr: "Commande {number} : paiement insuffisant, facture expirée.",
    de: "Bestellung {number}: zu wenig bezahlt, Rechnung abgelaufen.",
    it: "Ordine {number}: pagamento insufficiente, fattura scaduta."
  },
  "notice.canceled": {
    en: "Order {number}: paid after it was canceled.",
    fr: "Commande {number} : payée après son annulation.",
    de: "Bestellung {number}: nach der Stornierung bezahlt.",
    it: "Ordine {number}: pagato dopo il suo annullamento."
  },
  "notice.mismatch": {
    en: "Order {number}: an invoice of another amount.",
    fr: "Commande {number} : facture d'un autre montant.",
    de: "Bestellung {number}: Rechnung über einen anderen Betrag.",
    it: "Ordine {number}: fattura di un altro importo."
  },
  "notice.changed": {
    en: "Order {number}: paid, but its total changed after its invoice.",
    fr: "Commande {number} : payée, mais son total a changé après sa facture.",
    de: "Bestellung {number}: bezahlt, aber ihr Betrag hat sich nach der Rechnung geändert.",
    it: "Ordine {number}: pagato, ma il suo totale è cambiato dopo la fattura."
  },
  "notice.stale": {
    en: "Order {number}: payment not final after 90 days.",
    fr: "Commande {number} : paiement non définitif après 90 jours.",
    de: "Bestellung {number}: Zahlung nach 90 Tagen nicht endgültig.",
    it: "Ordine {number}: pagamento non definitivo dopo 90 giorni."
  },
  "notice.unrecorded": {
    en: "Order {number}: paid, but Wix did not record the payment.",
    fr: "Commande {number} : payée, mais Wix n'a pas enregistré le paiement.",
    de: "Bestellung {number}: bezahlt, aber Wix hat die Zahlung nicht erfasst.",
    it: "Ordine {number}: pagato, ma Wix non ha registrato il pagamento."
  },

  // The payment page, for the customer.
  "page.title": {
    en: "Pay with Bitcoin",
    fr: "Payer en bitcoin",
    de: "Mit Bitcoin bezahlen",
    it: "Paga in bitcoin"
  },
  "page.amount": {
    en: "{sats} sats",
    fr: "{sats} sats",
    de: "{sats} Sats",
    it: "{sats} sats"
  },
  "page.amountPrice": {
    en: "{sats} sats ({price})",
    fr: "{sats} sats ({price})",
    de: "{sats} Sats ({price})",
    it: "{sats} sats ({price})"
  },
  "page.timeLeft": {
    en: "Time left to pay: {minutes} min {seconds} s.",
    fr: "Temps restant pour payer : {minutes} min {seconds} s.",
    de: "Verbleibende Zeit zum Bezahlen: {minutes} Min. {seconds} s.",
    it: "Tempo rimasto per pagare: {minutes} min {seconds} s."
  },
  "page.timeUp": {
    en: "The time to pay is over. A payment made in time is still being looked for: this page will show it.",
    fr: "Le temps pour payer est écoulé. Un paiement fait à temps est encore recherché : cette page l'affichera.",
    de: "Die Zeit zum Bezahlen ist abgelaufen. Eine rechtzeitige Zahlung wird noch gesucht: Diese Seite zeigt sie an.",
    it: "Il tempo per pagare è scaduto. Un pagamento fatto in tempo è ancora cercato: questa pagina lo mostrerà."
  },
  "page.rest": {
    en: "Received {received} of {sats} sats. Pay the rest: {rest} sats.",
    fr: "Reçu {received} sur {sats} sats. Payez le reste : {rest} sats.",
    de: "{received} von {sats} Sats erhalten. Zahlen Sie den Rest: {rest} Sats.",
    it: "Ricevuti {received} di {sats} sats. Paghi il resto: {rest} sats."
  },
  "page.restPending": {
    en: "The invoice of the rest is being made: this page will show it.",
    fr: "La facture du reste est en cours de création : cette page l'affichera.",
    de: "Die Rechnung für den Rest wird erstellt: Diese Seite zeigt sie an.",
    it: "La fattura del resto è in preparazione: questa pagina la mostrerà."
  },
  "page.scan": {
    en: "Scan the QR code with your Bitcoin wallet, or open it on this device:",
    fr: "Scannez le code QR avec votre portefeuille Bitcoin, ou ouvrez-le sur cet appareil :",
    de: "Scannen Sie den QR-Code mit Ihrer Bitcoin-Wallet oder öffnen Sie ihn auf diesem Gerät:",
    it: "Scansioni il codice QR con il suo portafoglio Bitcoin, o lo apra su questo dispositivo:"
  },
  "page.qr": {
    en: "QR code to pay",
    fr: "Code QR pour payer",
    de: "QR-Code zum Bezahlen",
    it: "Codice QR per pagare"
  },
  "page.openWallet": {
    en: "Open in my wallet",
    fr: "Ouvrir dans mon portefeuille",
    de: "In meiner Wallet öffnen",
    it: "Apri nel mio portafoglio"
  },
  "page.invoice": {
    en: "Lightning invoice",
    fr: "Facture Lightning",
    de: "Lightning-Rechnung",
    it: "Fattura Lightning"
  },
  "page.address": {
    en: "Bitcoin address (on-chain)",
    fr: "Adresse Bitcoin (on-chain)",
    de: "Bitcoin-Adresse (on-chain)",
    it: "Indirizzo Bitcoin (on-chain)"
  },
  "page.confirming": {
    en: "Payment received: it is being confirmed on the Bitcoin network ({confirmations} of 3 confirmations, about 30 minutes). Your order is updated once it is confirmed: you may leave this page.",
    fr: "Paiement reçu : il est en cours de confirmation sur le réseau Bitcoin ({confirmations} sur 3 confirmations, environ 30 minutes). Votre commande est mise à jour une fois le paiement confirmé : vous pouvez quitter cette page.",
    de: "Zahlung erhalten: Sie wird im Bitcoin-Netzwerk bestätigt ({confirmations} von 3 Bestätigungen, etwa 30 Minuten). Ihre Bestellung wird nach der Bestätigung aktualisiert: Sie können diese Seite verlassen.",
    it: "Pagamento ricevuto: è in conferma sulla rete Bitcoin ({confirmations} di 3 conferme, circa 30 minuti). Il suo ordine viene aggiornato una volta confermato: può lasciare questa pagina."
  },
  "page.recording": {
    en: "Payment received. The shop is recording your order: this page takes you there in a moment.",
    fr: "Paiement reçu. La boutique enregistre votre commande : cette page vous y mène dans un instant.",
    de: "Zahlung erhalten. Der Shop erfasst Ihre Bestellung: Diese Seite führt Sie gleich dorthin.",
    it: "Pagamento ricevuto. Il negozio sta registrando il suo ordine: questa pagina la porta lì tra un momento."
  },
  "page.back": {
    en: "Back to the shop",
    fr: "Retour à la boutique",
    de: "Zurück zum Shop",
    it: "Torna al negozio"
  },
  "page.underpaidTitle": {
    en: "Payment incomplete",
    fr: "Paiement incomplet",
    de: "Zahlung unvollständig",
    it: "Pagamento incompleto"
  },
  "page.underpaid": {
    en: "Received {received} of {sats} sats, and the time to pay is over: the order is not paid. What you sent is with the shop, which settles it with you.",
    fr: "Reçu {received} sur {sats} sats, et le temps pour payer est écoulé : la commande n'est pas payée. Ce que vous avez envoyé est chez la boutique, qui le règle avec vous.",
    de: "{received} von {sats} Sats erhalten, und die Zeit zum Bezahlen ist abgelaufen: Die Bestellung ist nicht bezahlt. Was Sie gesendet haben, ist beim Shop, der es mit Ihnen regelt.",
    it: "Ricevuti {received} di {sats} sats, e il tempo per pagare è scaduto: l'ordine non è pagato. Ciò che ha inviato è presso il negozio, che lo regola con lei."
  },
  "page.checkAgain": {
    en: "Check the payment",
    fr: "Vérifier le paiement",
    de: "Zahlung prüfen",
    it: "Verifica il pagamento"
  },
  "page.refresh": {
    en: "This page checks the payment every {seconds} seconds.",
    fr: "Cette page vérifie le paiement toutes les {seconds} secondes.",
    de: "Diese Seite prüft die Zahlung alle {seconds} Sekunden.",
    it: "Questa pagina verifica il pagamento ogni {seconds} secondi."
  },
  // The page of an address that is not a payment page's.
  "link.title": {
    en: "Payment link",
    fr: "Lien de paiement",
    de: "Zahlungslink",
    it: "Link di pagamento"
  },
  "link.invalid": {
    en: "This link is not valid.",
    fr: "Ce lien n'est pas valide.",
    de: "Dieser Link ist ungültig.",
    it: "Questo link non è valido."
  },

  // The status page, for the merchant.
  "status.title": {
    en: "sattle.me Checkout: status",
    fr: "sattle.me Checkout : état",
    de: "sattle.me Checkout: Status",
    it: "sattle.me Checkout: stato"
  },
  "status.tokenLabel": {
    en: "Status page token (Secrets Manager: sattleme-checkout-status-token)",
    fr: "Jeton de la page d'état (Secrets Manager : sattleme-checkout-status-token)",
    de: "Token der Statusseite (Secrets Manager: sattleme-checkout-status-token)",
    it: "Token della pagina di stato (Secrets Manager: sattleme-checkout-status-token)"
  },
  "status.tokenHint": {
    en: "The token has 32 characters or more: a shorter one is not sent, and the page does not change.",
    fr: "Le jeton compte 32 caractères ou plus : un jeton plus court n'est pas envoyé, et la page ne change pas.",
    de: "Das Token hat 32 Zeichen oder mehr: Ein kürzeres wird nicht gesendet, und die Seite ändert sich nicht.",
    it: "Il token ha 32 caratteri o più: uno più corto non viene inviato, e la pagina non cambia."
  },
  "status.submit": {
    en: "Show the status",
    fr: "Afficher l'état",
    de: "Status anzeigen",
    it: "Mostra lo stato"
  },
  "status.wrongToken": {
    en: "Wrong token.",
    fr: "Jeton incorrect.",
    de: "Falsches Token.",
    it: "Token errato."
  },
  "status.noToken": {
    en: "First create, in the Secrets Manager, the sattleme-checkout-status-token secret: a random value of 32 characters at least.",
    fr: "Créez d'abord, dans le Secrets Manager, le secret sattleme-checkout-status-token : une valeur aléatoire de 32 caractères au moins.",
    de: "Erstellen Sie zuerst im Secrets Manager das Secret sattleme-checkout-status-token: ein zufälliger Wert von mindestens 32 Zeichen.",
    it: "Crei prima, nel Secrets Manager, il segreto sattleme-checkout-status-token: un valore casuale di almeno 32 caratteri."
  },
  "status.versions": {
    en: "Versions: plugin {plugin}, SDK {sdk}, checkout-spec {spec}; the site's backend runs Node {node}.",
    fr: "Versions : plugin {plugin}, SDK {sdk}, checkout-spec {spec} ; le backend du site tourne sous Node {node}.",
    de: "Versionen: Plugin {plugin}, SDK {sdk}, checkout-spec {spec}; das Backend der Website läuft mit Node {node}.",
    it: "Versioni: plugin {plugin}, SDK {sdk}, checkout-spec {spec}; il backend del sito gira su Node {node}."
  },
  "status.timeZone": {
    en: "Times in {zone}, the site's time zone (Settings, General Info).",
    fr: "Heures en {zone}, le fuseau horaire du site (Paramètres, Infos générales).",
    de: "Zeiten in {zone}, der Zeitzone der Website (Einstellungen, Allgemeine Infos).",
    it: "Orari in {zone}, il fuso orario del sito (Impostazioni, Info generali)."
  },
  "status.timeZoneUtc": {
    en: "Times in UTC: Wix gave no time zone of the site.",
    fr: "Heures en UTC : Wix n'a pas donné de fuseau horaire du site.",
    de: "Zeiten in UTC: Wix hat keine Zeitzone der Website angegeben.",
    it: "Orari in UTC: Wix non ha dato un fuso orario del sito."
  },
  "status.connection": {
    en: "Connection",
    fr: "Connexion",
    de: "Verbindung",
    it: "Connessione"
  },
  "status.merchant": {
    en: "The key in the Secrets Manager is {business}'s: {min} to {max} sats, {addresses} on-chain addresses in the lot.",
    fr: "La clé du gestionnaire de secrets est celle de {business} : de {min} à {max} sats, {addresses} adresses on-chain dans le lot.",
    de: "Der Schlüssel im Secrets Manager gehört {business}: {min} bis {max} Sats, {addresses} On-Chain-Adressen im Vorrat.",
    it: "La chiave nel Secrets Manager è di {business}: da {min} a {max} sats, {addresses} indirizzi on-chain nel lotto."
  },
  "status.merchant.one": {
    en: "The key in the Secrets Manager is {business}'s: {min} to {max} sats, {addresses} on-chain address in the lot.",
    fr: "La clé du gestionnaire de secrets est celle de {business} : de {min} à {max} sats, {addresses} adresse on-chain dans le lot.",
    de: "Der Schlüssel im Secrets Manager gehört {business}: {min} bis {max} Sats, {addresses} On-Chain-Adresse im Vorrat.",
    it: "La chiave nel Secrets Manager è di {business}: da {min} a {max} sats, {addresses} indirizzo on-chain nel lotto."
  },
  "status.minutes": {
    en: "Time to pay an invoice: {minutes} minutes (the connection's setting).",
    fr: "Délai pour payer une facture : {minutes} minutes (réglage de la connexion).",
    de: "Zeit zum Bezahlen einer Rechnung: {minutes} Minuten (Einstellung der Verbindung).",
    it: "Tempo per pagare una fattura: {minutes} minuti (impostazione della connessione)."
  },
  "status.minutes.one": {
    en: "Time to pay an invoice: {minutes} minute (the connection's setting).",
    fr: "Délai pour payer une facture : {minutes} minute (réglage de la connexion).",
    de: "Zeit zum Bezahlen einer Rechnung: {minutes} Minute (Einstellung der Verbindung).",
    it: "Tempo per pagare una fattura: {minutes} minuto (impostazione della connessione)."
  },
  "status.connectRefused": {
    en: "The last connection in Wix's payment settings was refused ({at}, {code}). Wix may refuse this payment method until a connection succeeds: connect sattle.me Checkout again in the payment settings.",
    fr: "La dernière connexion dans les réglages de paiement de Wix a été refusée ({at}, {code}). Wix peut refuser ce moyen de paiement tant qu'une connexion n'a pas réussi : reconnectez sattle.me Checkout dans les réglages de paiement.",
    de: "Die letzte Verbindung in den Zahlungseinstellungen von Wix wurde abgelehnt ({at}, {code}). Wix kann diese Zahlungsart ablehnen, bis eine Verbindung gelingt: Verbinden Sie sattle.me Checkout in den Zahlungseinstellungen erneut.",
    it: "L'ultima connessione nelle impostazioni di pagamento di Wix è stata rifiutata ({at}, {code}). Wix può rifiutare questo metodo di pagamento finché una connessione non riesce: colleghi di nuovo sattle.me Checkout nelle impostazioni di pagamento."
  },
  "status.merchantFailed": {
    en: "The business could not be read ({code}).",
    fr: "Le commerce n'a pas pu être lu ({code}).",
    de: "Das Geschäft konnte nicht gelesen werden ({code}).",
    it: "Non è stato possibile leggere l'attività ({code})."
  },
  "status.page": {
    en: "Customers' payment page",
    fr: "Page de paiement des clients",
    de: "Zahlungsseite der Kunden",
    it: "Pagina di pagamento dei clienti"
  },
  "status.siteSaved": {
    en: "Site address: {url}. Customers pay on a page at this address, which checks their payment, then sends them to their order's Wix page.",
    fr: "Adresse du site : {url}. Les clients paient sur une page à cette adresse, qui vérifie leur paiement, puis les envoie sur la page Wix de leur commande.",
    de: "Adresse der Website: {url}. Die Kunden bezahlen auf einer Seite unter dieser Adresse, die ihre Zahlung prüft und sie dann zur Wix-Seite ihrer Bestellung weiterleitet.",
    it: "Indirizzo del sito: {url}. I clienti pagano su una pagina a questo indirizzo, che verifica il loro pagamento e poi li manda alla pagina Wix del loro ordine."
  },
  "status.siteInvalid": {
    en: "This site's address ({url}) is not an https address of HTTP functions: the payment page cannot be on it. Open this status page at the site's https address.",
    fr: "L'adresse de ce site ({url}) n'est pas une adresse https de fonctions HTTP : la page de paiement ne peut pas s'y trouver. Ouvrez cette page d'état à l'adresse https du site.",
    de: "Die Adresse dieser Website ({url}) ist keine https-Adresse von HTTP-Funktionen: Die Zahlungsseite kann nicht darauf liegen. Öffnen Sie diese Statusseite unter der https-Adresse der Website.",
    it: "L'indirizzo di questo sito ({url}) non è un indirizzo https di funzioni HTTP: la pagina di pagamento non può trovarvisi. Apra questa pagina di stato all'indirizzo https del sito."
  },
  "status.jobs": {
    en: "Background checks",
    fr: "Vérifications de fond",
    de: "Hintergrundprüfungen",
    it: "Verifiche in background"
  },
  "status.jobsNote": {
    en: "The payment page checks a payment while its customer is on it. One scheduled job, hourly, does the rest: an order whose customer left the page is updated at its next run, as is an on-chain payment once confirmed. Its last runs are here.",
    fr: "La page de paiement vérifie un paiement tant que le client y est. Une tâche planifiée, toutes les heures, fait le reste : une commande dont le client a quitté la page est mise à jour à son exécution suivante, de même qu'un paiement on-chain une fois confirmé. Ses dernières exécutions sont ici.",
    de: "Die Zahlungsseite prüft eine Zahlung, solange der Kunde darauf ist. Ein geplanter Job, stündlich, erledigt den Rest: Eine Bestellung, deren Kunde die Seite verlassen hat, wird bei seiner nächsten Ausführung aktualisiert, ebenso eine On-Chain-Zahlung nach ihrer Bestätigung. Seine letzten Ausführungen stehen hier.",
    it: "La pagina di pagamento verifica un pagamento finché il cliente vi rimane. Un'attività pianificata, ogni ora, fa il resto: un ordine il cui cliente ha lasciato la pagina viene aggiornato alla sua esecuzione successiva, così come un pagamento on-chain una volta confermato. Le sue ultime esecuzioni sono qui."
  },
  "status.jobsNone": {
    en: "The job has not run yet: check the jobs.config file, and publish the site.",
    fr: "La tâche n'a pas encore tourné : vérifiez le fichier jobs.config, et publiez le site.",
    de: "Der Job ist noch nicht gelaufen: Prüfen Sie die Datei jobs.config und veröffentlichen Sie die Website.",
    it: "L'attività non è ancora stata eseguita: verifichi il file jobs.config e pubblichi il sito."
  },
  "status.jobsLate": {
    en: "The job's last run started more than 70 minutes ago: check the jobs.config file and the site's logs.",
    fr: "La dernière exécution de la tâche a commencé il y a plus de 70 minutes : vérifiez le fichier jobs.config et les journaux du site.",
    de: "Die letzte Ausführung des Jobs begann vor mehr als 70 Minuten: Prüfen Sie die Datei jobs.config und die Protokolle der Website.",
    it: "L'ultima esecuzione dell'attività è iniziata più di 70 minuti fa: verifichi il file jobs.config e i log del sito."
  },
  "status.open": {
    en: "Payments under way",
    fr: "Paiements en cours",
    de: "Laufende Zahlungen",
    it: "Pagamenti in corso"
  },
  "status.attention": {
    en: "Payments that need you",
    fr: "Paiements à traiter",
    de: "Zu bearbeitende Zahlungen",
    it: "Pagamenti da gestire"
  },
  "status.attentionNote": {
    en: "Wix lists an order only once it is paid: these are not in the list of orders. For each, the plugin makes a task in the dashboard, on the customer's contact card: the Task column says whether it was made.",
    fr: "Wix ne liste une commande qu'une fois payée : celles-ci n'apparaissent pas dans la liste des commandes. Pour chacune, le plugin fait une tâche dans le tableau de bord, sur la fiche du client : la colonne Tâche dit si elle a été faite.",
    de: "Wix listet eine Bestellung erst, wenn sie bezahlt ist: Diese stehen nicht in der Bestellliste. Für jede erstellt das Plugin eine Aufgabe im Dashboard, auf der Kontaktkarte des Kunden: Die Spalte Aufgabe zeigt, ob sie erstellt wurde.",
    it: "Wix elenca un ordine solo quando è pagato: questi non compaiono nell'elenco degli ordini. Per ognuno, il plugin crea un'attività nel pannello di controllo, sulla scheda del cliente: la colonna Attività indica se è stata creata."
  },
  "status.refusals": {
    en: "Payments refused",
    fr: "Paiements refusés",
    de: "Abgelehnte Zahlungen",
    it: "Pagamenti rifiutati"
  },
  "status.warnings": {
    en: "Warnings",
    fr: "Avertissements",
    de: "Warnungen",
    it: "Avvisi"
  },
  "warning.sdk": {
    en: "The SDK left aside data of a newer format: update the plugin.",
    fr: "Le SDK a ignoré une donnée d'un format plus récent : mettez le plugin à jour.",
    de: "Das SDK hat Daten eines neueren Formats übergangen: Aktualisieren Sie das Plugin.",
    it: "L'SDK ha ignorato dati di un formato più recente: aggiorni il plugin."
  },
  "warning.lightningOnly": {
    en: "Invoices made without an on-chain address, payable in Lightning only (the last: {ref}): the lot of addresses was empty or had no free address, or the explorer did not answer (mempool.space, or the Bitcoin node the sattle.me app names). Opening the sattle.me app fills the lot again.",
    fr: "Factures faites sans adresse on-chain, payables en Lightning seulement (la dernière : {ref}) : le lot d'adresses était vide ou sans adresse libre, ou l'explorateur n'a pas répondu (mempool.space, ou le nœud Bitcoin que l'app sattle.me indique). Ouvrir l'app sattle.me remplit à nouveau le lot.",
    de: "Rechnungen ohne On-Chain-Adresse erstellt, nur per Lightning zahlbar (die letzte: {ref}): Der Adressvorrat war leer oder hatte keine freie Adresse, oder der Explorer hat nicht geantwortet (mempool.space oder der Bitcoin-Knoten, den die sattle.me-App angibt). Das Öffnen der sattle.me-App füllt den Vorrat wieder auf.",
    it: "Fatture create senza indirizzo on-chain, pagabili solo in Lightning (l'ultima: {ref}): il lotto di indirizzi era vuoto o senza indirizzi liberi, oppure l'explorer non ha risposto (mempool.space, o il nodo Bitcoin indicato dall'app sattle.me). Aprire l'app sattle.me ricarica il lotto."
  },
  "col.task": {
    en: "Task",
    fr: "Tâche",
    de: "Aufgabe",
    it: "Attività"
  },
  "taskState.done": {
    en: "made",
    fr: "faite",
    de: "erstellt",
    it: "creata"
  },
  "taskState.failed": {
    en: "refused by Wix",
    fr: "refusée par Wix",
    de: "von Wix abgelehnt",
    it: "rifiutata da Wix"
  },
  "taskState.pending": {
    en: "being made",
    fr: "en cours de création",
    de: "wird erstellt",
    it: "in creazione"
  },
  "taskState.trying": {
    en: "not made yet: tried at {tries} of {max} checks; Wix answered: {reason}",
    fr: "pas encore faite : essayée à {tries} vérifications sur {max} ; Wix a répondu : {reason}",
    de: "noch nicht erstellt: bei {tries} von {max} Prüfungen versucht; Wix antwortete: {reason}",
    it: "non ancora creata: tentata a {tries} controlli su {max}; Wix ha risposto: {reason}"
  },
  "status.none": {
    en: "None.",
    fr: "Aucun.",
    de: "Keine.",
    it: "Nessuno."
  },
  "col.start": {
    en: "Start",
    fr: "Début",
    de: "Beginn",
    it: "Inizio"
  },
  "col.end": { en: "End", fr: "Fin", de: "Ende", it: "Fine" },
  "col.checks": {
    en: "Checks",
    fr: "Vérifications",
    de: "Prüfungen",
    it: "Verifiche"
  },
  "col.errors": {
    en: "Errors",
    fr: "Erreurs",
    de: "Fehler",
    it: "Errori"
  },
  "col.left": {
    en: "Left for the next run",
    fr: "Laissés à l'exécution suivante",
    de: "Für die nächste Ausführung übrig",
    it: "Lasciati all'esecuzione successiva"
  },
  "col.ref": {
    en: "Reference",
    fr: "Référence",
    de: "Referenz",
    it: "Riferimento"
  },
  "col.state": {
    en: "State",
    fr: "État",
    de: "Status",
    it: "Stato"
  },
  "col.received": {
    en: "Received (sats)",
    fr: "Reçu (sats)",
    de: "Erhalten (Sats)",
    it: "Ricevuto (sats)"
  },
  "col.due": {
    en: "Due (sats)",
    fr: "Dû (sats)",
    de: "Fällig (Sats)",
    it: "Dovuto (sats)"
  },
  "col.address": {
    en: "Deposit address",
    fr: "Adresse de dépôt",
    de: "Einzahlungsadresse",
    it: "Indirizzo di deposito"
  },
  "col.expires": {
    en: "Ends",
    fr: "Fin",
    de: "Endet",
    it: "Scade"
  },
  "col.lastCheck": {
    en: "Last check",
    fr: "Dernière vérification",
    de: "Letzte Prüfung",
    it: "Ultima verifica"
  },
  "col.error": {
    en: "Error",
    fr: "Erreur",
    de: "Fehler",
    it: "Errore"
  },
  "col.reason": {
    en: "Reason",
    fr: "Raison",
    de: "Grund",
    it: "Motivo"
  },
  "col.at": {
    en: "Date",
    fr: "Date",
    de: "Datum",
    it: "Data"
  },
  "col.count": {
    en: "Times",
    fr: "Fois",
    de: "Mal",
    it: "Volte"
  },
  "col.message": {
    en: "Message",
    fr: "Message",
    de: "Meldung",
    it: "Messaggio"
  },
  "col.order": {
    en: "Wix order",
    fr: "Commande Wix",
    de: "Wix-Bestellung",
    it: "Ordine Wix"
  },
  "error.network": {
    en: "the business's relays or payment services did not answer",
    fr: "les relais ou les services de paiement du commerce n'ont pas répondu",
    de: "die Relays oder Zahlungsdienste des Geschäfts haben nicht geantwortet",
    it: "i relay o i servizi di pagamento dell'attività non hanno risposto"
  },
  "error.deadline": {
    en: "the check ran out of time",
    fr: "la vérification a manqué de temps",
    de: "die Prüfung hatte nicht genug Zeit",
    it: "la verifica ha esaurito il tempo"
  },
  "error.invalid_invoice": {
    en: "an answer about the payment failed the checks",
    fr: "une réponse sur le paiement n'a pas passé les contrôles",
    de: "eine Antwort zur Zahlung hat die Prüfungen nicht bestanden",
    it: "una risposta sul pagamento non ha superato i controlli"
  },
  "error.invalid_order": {
    en: "the invoice kept with the payment is not one the SDK made",
    fr: "la facture gardée avec le paiement n'est pas une facture du SDK",
    de: "die mit der Zahlung gespeicherte Rechnung stammt nicht vom SDK",
    it: "la fattura salvata con il pagamento non è una fattura dell'SDK"
  },
  "error.revoked": {
    en: "the integration was removed in the sattle.me app",
    fr: "l'intégration a été supprimée dans l'app sattle.me",
    de: "die Integration wurde in der sattle.me-App entfernt",
    it: "l'integrazione è stata rimossa nell'app sattle.me"
  },
  "error.channel_not_found": {
    en: "the business's relays did not answer with its integration",
    fr: "les relais du commerce n'ont pas répondu avec son intégration",
    de: "die Relays des Geschäfts haben nicht mit seiner Integration geantwortet",
    it: "i relay dell'attività non hanno risposto con la sua integrazione"
  },
  "error.no_key": {
    en: "no key in the Secrets Manager",
    fr: "aucune clé dans le Secrets Manager",
    de: "kein Schlüssel im Secrets Manager",
    it: "nessuna chiave nel Secrets Manager"
  },
  "error.invalid_key": {
    en: "the key in the Secrets Manager is not an integration key",
    fr: "la clé du Secrets Manager n'est pas une clé d'intégration",
    de: "der Schlüssel im Secrets Manager ist kein Integrationsschlüssel",
    it: "la chiave nel Secrets Manager non è una chiave di integrazione"
  },
  "error.submit_event": {
    en: "Wix refused the payment's event: sent again at the next check",
    fr: "Wix a refusé l'événement du paiement : renvoyé à la prochaine vérification",
    de: "Wix hat das Ereignis der Zahlung abgelehnt: bei der nächsten Prüfung erneut gesendet",
    it: "Wix ha rifiutato l'evento del pagamento: inviato di nuovo alla prossima verifica"
  },
  "error.unexpected": {
    en: "an unexpected error (the site's logs say which)",
    fr: "une erreur inattendue (les journaux du site disent laquelle)",
    de: "ein unerwarteter Fehler (die Protokolle der Website nennen ihn)",
    it: "un errore imprevisto (i log del sito dicono quale)"
  },
  "state.new": {
    en: "created",
    fr: "créée",
    de: "erstellt",
    it: "creato"
  },
  "state.open": {
    en: "open",
    fr: "ouverte",
    de: "offen",
    it: "aperto"
  },
  "state.unconfirmed": {
    en: "being confirmed",
    fr: "en confirmation",
    de: "in Bestätigung",
    it: "in conferma"
  },
  "state.paid": {
    en: "paid",
    fr: "payée",
    de: "bezahlt",
    it: "pagato"
  },
  "state.expired": {
    en: "expired",
    fr: "expirée",
    de: "abgelaufen",
    it: "scaduto"
  },
  "state.attention": {
    en: "needs you",
    fr: "à traiter",
    de: "zu bearbeiten",
    it: "da gestire"
  },
  "reason.underpaid": {
    en: "underpaid",
    fr: "paiement insuffisant",
    de: "zu wenig bezahlt",
    it: "pagamento insufficiente"
  },
  "reason.canceled": {
    en: "paid after cancellation",
    fr: "payée après annulation",
    de: "nach Stornierung bezahlt",
    it: "pagato dopo l'annullamento"
  },
  "reason.mismatch": {
    en: "invoice of another amount",
    fr: "facture d'un autre montant",
    de: "Rechnung über einen anderen Betrag",
    it: "fattura di un altro importo"
  },
  "reason.changed": {
    en: "paid, the order's total changed",
    fr: "payée, total de la commande changé",
    de: "bezahlt, Bestellbetrag geändert",
    it: "pagato, totale dell'ordine cambiato"
  },
  "reason.stale": {
    en: "not final after 90 days",
    fr: "non définitif après 90 jours",
    de: "nach 90 Tagen nicht endgültig",
    it: "non definitivo dopo 90 giorni"
  },
  "reason.unrecorded": {
    en: "paid, not recorded by Wix",
    fr: "payée, non enregistrée par Wix",
    de: "bezahlt, von Wix nicht erfasst",
    it: "pagato, non registrato da Wix"
  }
};

/**
 * Whether `count` takes the singular in `language`: 1 in English, German and Italian; 0 and 1 in
 * French ("0 minute", "1 minute", "2 minutes").
 */
export function isSingular(language, count) {
  const n = Number(count);
  return pickLanguage(language) === "fr" ? n === 0 || n === 1 : n === 1;
}

/**
 * The text `key` in `language` for `count` of something: `key.one` when `count` takes the
 * singular and the key has one, else `key`, its {placeholders} filled from `values`.
 */
export function tn(language, key, count, values) {
  const one = `${key}.one`;
  return t(language, isSingular(language, count) && TEXTS[one] ? one : key, values);
}

/** The text `key` in `language`, its {placeholders} filled from `values`. */
export function t(language, key, values) {
  const entry = TEXTS[key];
  if (!entry) return key;
  const text = entry[pickLanguage(language)] || entry.en;
  return text.replace(/\{([A-Za-z]+)\}/g, (whole, name) =>
    values && values[name] !== undefined && values[name] !== null ? String(values[name]) : whole
  );
}

/**
 * `text` within `max` characters, counted as UTF-16 code units (never fewer than the characters
 * Wix counts): whole when it fits, else cut at a character boundary, never inside a surrogate
 * pair, and ended with "…".
 */
export function clip(text, max) {
  const value = String(text);
  if (value.length <= max) return value;
  if (max < 1) return "";
  let end = max - 1;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end).replace(/\s+$/, "")}…`;
}

/** Every key, for the tests: each has a text in every language. */
export function keys() {
  return Object.keys(TEXTS);
}

/** Whether `key` has a text (an error's plain words, say). */
export function hasText(key) {
  return Object.prototype.hasOwnProperty.call(TEXTS, key);
}

export function textOf(key, language) {
  return TEXTS[key] ? TEXTS[key][language] : undefined;
}
