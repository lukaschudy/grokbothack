import { SignInForms } from "./forms";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="page">
      <div className="shell narrow">
        <header className="product-heading">
          <h1>Sign in to Roomline</h1>
          <p>Anyone can search. Members see venue contacts, ask Roomline to call venues, and post venues once someone vouches for them.</p>
        </header>
        <SignInForms next={next ?? "/"} />
      </div>
    </main>
  );
}
