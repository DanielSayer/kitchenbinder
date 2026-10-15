export function SupportContact({ email }: { email: string | null }) {
  return email ? (
    <p>
      Email <a href={`mailto:${email}`}>{email}</a> if you cannot sign in or
      need help with a request.
    </p>
  ) : (
    <p className="muted">
      Support contact is not configured in this development or test environment.
    </p>
  );
}
