import { alexaNavigationPath, type AlexaNavigation } from "@/shared/alexa/turn";

const subscribers = new Set<(path: string) => void>();
/** Typed destinations only; neither notes nor model output supply a URL. */
export function navigateAlexa(navigation: AlexaNavigation): void {
  const path = alexaNavigationPath(navigation);
  if (path) for (const subscriber of subscribers) subscriber(path);
}
export function subscribeAlexaNavigation(subscriber: (path: string) => void): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
