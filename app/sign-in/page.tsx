import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  );
}
