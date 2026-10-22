import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { signOutAction } from "../actions";

export default async function Account() {
  const me = await currentMember();
  if (!me) redirect("/signin");
  return (
    <main className="page">
      <div className="shell narrow">
        <header className="product-heading">
          <h1>{me.display_name}</h1>
          <p>{me.community ?? "No community set"}</p>
        </header>
        <div className="stack">
          {me.banned ? (
            <p className="notice bad">You posted a venue that members marked as junk, so you can no longer post.</p>
          ) : me.can_post ? (
            <p className="notice">
              You can post and update venues{me.is_root ? " as a founding organiser" : me.vouched_by.length ? `, vouched for by ${me.vouched_by.join(", ")}` : ""}.
              {me.can_vouch ? " You can vouch for others." : " You've lost vouching rights because someone you vouched for posted junk."}
            </p>
          ) : (
            <p className="notice warn">Nobody has vouched for you yet. Ask an organiser who knows you to vouch for you on the People page.</p>
          )}
          <form action={signOutAction}><button className="button quiet">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
