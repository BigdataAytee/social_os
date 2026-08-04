import { redirect } from "next/navigation";

/** /studio on its own has no meaning — send people to the Dashboard. */
export default function StudioIndexPage() {
  redirect("/dashboard");
}
