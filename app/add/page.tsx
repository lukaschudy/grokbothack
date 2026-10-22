import Link from "next/link";
import { currentMember } from "@/lib/session";
import { AddVenue } from "./add-venue";

export default async function AddPage() {
  const me = await currentMember();
  return (
    <main className="page">
      <div className="shell narrow">
        <header className="product-heading">
          <h1>Add a venue from a Luma link</h1>
          <p>Paste an event that happened there. We fill in the venue from the event, then ask three questions.</p>
        </header>
        {!me && (
          <p className="notice warn" style={{ marginBottom: 20 }}>
            <Link className="link" href="/signin?next=/add">Sign in</Link> to post. Posting needs a vouch from a member.
          </p>
        )}
        {me && !me.can_post && (
          <p className="notice warn" style={{ marginBottom: 20 }}>
            You can fill this in, but nobody has vouched for you yet, so publishing will be blocked.{" "}
            <Link className="link" href="/people">How vouching works</Link>
          </p>
        )}
        <AddVenue />
      </div>
    </main>
  );
}
