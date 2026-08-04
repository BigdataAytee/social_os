import { redirect } from "next/navigation";

/** Root is a doorway, not a page — middleware has already decided whether the
 *  visitor is authenticated by the time this runs. */
export default function RootPage() {
  redirect("/dashboard");
}
