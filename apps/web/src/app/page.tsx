import { Button } from '@/shared/components/Button';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <h1 className="text-4xl font-bold">Courseforge</h1>
      <Button variant="primary">Comenzar</Button>
    </main>
  );
}
