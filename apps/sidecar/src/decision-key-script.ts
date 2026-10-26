// The one script on the key page: it posts the form with fetch, shows a failed test in place and keeps every field as typed. Without it the form still posts normally.
import { createHash } from "node:crypto";

/** The script as it is inlined into the entry page. */
export const KEY_PAGE_SCRIPT = `
const form = document.querySelector("form");
const receipt = document.getElementById("receipt");
const button = form.querySelector("button");
const details = form.querySelector("details");
const provider = form.elements.provider;
function sync() {
  for (const label of form.querySelectorAll("[data-for]")) label.hidden = !label.dataset.for.split(" ").includes(provider.value);
  if (provider.value !== "jev") details.open = true;
}
function show(text) {
  receipt.textContent = text;
  receipt.hidden = false;
  button.disabled = false;
  button.textContent = form.dataset.retry;
  if ([...details.querySelectorAll("input")].some((input) => input.value !== "" && !input.closest("label").hidden)) details.open = true;
}
provider.addEventListener("change", sync);
sync();
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {};
  for (const input of form.querySelectorAll("select, input")) if (input.value.trim() !== "" && !(input.closest("label")?.hidden)) body[input.name] = input.value.trim();
  button.disabled = true;
  button.textContent = form.dataset.busy;
  try {
    const response = await fetch(form.action, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const reply = await response.json();
    if (reply.ok) location.replace(reply.next);
    else show(reply.receipt);
  } catch {
    show(form.dataset.network);
  }
});
`;

/** The Content-Security-Policy source that allows exactly that script. */
export const KEY_PAGE_SCRIPT_SOURCE = `'sha256-${createHash("sha256").update(KEY_PAGE_SCRIPT).digest("base64")}'`;
