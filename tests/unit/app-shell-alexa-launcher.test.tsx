import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
vi.mock("next/navigation", () => ({ usePathname: () => "/patients" }));
vi.mock("@/components/BandeauSeanceEnCours", () => ({ BandeauSeanceEnCours: () => null }));
vi.mock("@/components/BootVoix", () => ({ BootVoix: () => null }));
vi.mock("@/components/PaletteCommande", () => ({ PaletteCommande: () => null }));
vi.mock("@/components/PanneauJarvis", () => ({ PanneauJarvis: () => null }));
vi.mock("@/components/coquille/Rail", () => ({ Rail: () => null }));
vi.mock("@/components/coquille/Topbar", () => ({ Topbar: () => null }));

function renderShell(props: { readonly role?: "practitioner" | "assistant"; readonly sansBulle?: boolean } = {}): string {
  return renderToStaticMarkup(
    <AppShell
      role={props.role ?? "practitioner"}
      nomComplet="Docteure"
      onDeconnexion={() => undefined}
      {...(props.sansBulle === undefined ? {} : { sansBulle: props.sansBulle })}
    >
      <main>Patients</main>
    </AppShell>,
  );
}

it("shows the Alexa launcher for a practitioner on ordinary application pages", () => {
  expect(renderShell()).toContain('aria-label="Ouvrir Alexa"');
});

it("keeps the launcher hidden on the Alexa conversation page", () => {
  expect(renderShell({ sansBulle: true })).not.toContain('aria-label="Ouvrir Alexa"');
});

it("does not add the launcher to the assistant role", () => {
  expect(renderShell({ role: "assistant" })).not.toContain('aria-label="Ouvrir Alexa"');
});
