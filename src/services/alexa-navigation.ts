import { alexaNavigationPath, type AlexaNavigation } from "@/shared/alexa/turn";

const subscribers = new Set<(path: string) => void>();
/** Typed destinations only; neither notes nor model output supply a URL. */
export function navigateAlexa(navigation: AlexaNavigation): void {
  const path = alexaNavigationPath(navigation);
  if (!path) return;
  // A fresh query value lets the Documents screen distinguish repeated voice
  // requests for the same issued document and relaunch its existing dialog.
  const destination = navigation.target === "document" && navigation.print === true
    ? `${path}&printAttemptId=${crypto.randomUUID()}`
    : path;
  for (const subscriber of subscribers) subscriber(destination);
}
export function subscribeAlexaNavigation(subscriber: (path: string) => void): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
