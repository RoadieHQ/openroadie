import { Link } from 'react-router';
import { Network } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';

export function ViewRelationshipGraphButton({ to }: { to: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={to}>
        <Network className="size-4" />
        View graph
      </Link>
    </Button>
  );
}
