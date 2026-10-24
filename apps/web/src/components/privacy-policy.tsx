import { Link } from "@tanstack/react-router";

export function PrivacyPolicy({ embedded = false }: { embedded?: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  return (
    <div className="privacy-policy">
      <section className="help-section">
        <Heading>Sign-in</Heading>
        <p>
          Google or Discord handles sign-in. We store your account ID, name,
          email, profile image and session details. Sessions may include your IP
          address and browser information.
        </p>
        <p>
          Kitchenbinder does not manage your Google or Discord password. Change
          your password, email and security settings with your sign-in provider.
        </p>
      </section>
      <section className="help-section">
        <Heading>Recipe capture and AI</Heading>
        <p>
          To import or generate recipes, we send your input and tag names and
          descriptions to OpenAI. Leave private information out of recipes and
          tags.
        </p>
        <p>
          For a pasted link, our server fetches the page and extracts recipe
          content. The browser extension reads recipe content from the page you
          choose to capture and sends that content and its source URL to
          Kitchenbinder. It does not send your browsing history or browser
          cookies. Check the capture preview before sending.
        </p>
        <p>
          Extension imports are stored with their input, source URL, processing
          status and result so you can return to them. Saved recipes retain
          their content and source link. Manually entering or editing a recipe
          does not require AI processing.
        </p>
        <p>
          AI can make mistakes. Check ingredients, quantities and instructions
          before using a recipe.
        </p>
      </section>
      <section className="help-section">
        <Heading>Privacy and sharing</Heading>
        <p>
          Personal recipes are available to your account. Recipes saved to a
          group are available to its members. Group members can see member
          names. Recipe tags and custom tag definitions are shared within the
          collection. Favourites, ratings, cooking notes, shopping lists and
          meal plans belong to your account, including when you use a shared
          recipe.
        </p>
        <p>
          Kitchenbinder uses browser storage for preferences, recipe drafts and
          cooking progress. These can remain on a device after you sign out.
          Clear this site's browser data on a shared device. Support reports
          contain the text you submit and are linked to your account so the
          operator can investigate.
        </p>
      </section>
      <section className="help-section">
        <Heading>Billing</Heading>
        <p>
          Polar handles Pro subscriptions and payments. We send your account ID,
          name and email to Polar when you open checkout. We store your Polar
          customer ID, subscription status and usage allowances. Payment card
          details stay with the payment provider.
        </p>
        <p>
          Cancel your subscription in Plan &amp; billing before account deletion
          can be completed. Billing records may need to be retained by Polar for
          tax and legal obligations. We keep AI spending records without account
          details to enforce service limits.
        </p>
      </section>
      <section className="help-section">
        <Heading>Leaving Kitchenbinder</Heading>
        <p>
          You can request deletion from account settings. The request is
          reviewed manually and can be cancelled while pending. It does not
          delete your Google or Discord account.
        </p>
        <p>
          Before deletion can be completed, transfer any groups you own to
          another member or explicitly delete those groups. Deleting a group
          removes its shared recipes for everyone. We do not automatically
          choose a new owner or delete a group for you.
        </p>
        <p>
          Account deletion removes your personal recipes, preferences, private
          activity, imports, support reports, memberships, sessions and
          extension connections from the live database. Recipes you contributed
          to surviving groups stay in those groups with the account link
          removed. Copies saved by other people remain. Names or personal
          details written inside shared recipe text are not automatically
          removed, so review those before requesting deletion.
        </p>
        <p>
          Deleting an account does not clear browser storage on your devices or
          recall content already sent to an AI provider. Ask support about any
          specific retention or removal concern.
        </p>
        <div className="help-actions">
          <Link to="/settings" className="button button-outline">
            Account settings
          </Link>
          <Link to="/support" className="text-button">
            Support and report a problem
          </Link>
        </div>
      </section>
    </div>
  );
}
