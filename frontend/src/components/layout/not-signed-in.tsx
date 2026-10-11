import { Icons } from '@/components/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';

/** Shown until sign-in pages exist (step 18) when there is no token. */
export function NotSignedIn() {
  return (
    <Empty className='m-6 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.lock />
        </EmptyMedia>
        <EmptyTitle>Not signed in</EmptyTitle>
        <EmptyDescription>
          Sign-in pages are not built yet. For local development, set DEV_AUTO_LOGIN=true in
          frontend/.env.local, make sure the backend is running and seeded, and reload.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Shown when the user has no project yet. */
export function NoProject() {
  return (
    <Empty className='m-6 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icons.setup />
        </EmptyMedia>
        <EmptyTitle>No project yet</EmptyTitle>
        <EmptyDescription>
          Create a project with POST /api/v1/projects, or run npm run seed:demo in backend/ for demo
          data.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
