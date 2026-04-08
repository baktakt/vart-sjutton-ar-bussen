import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCity, allCities } from '@/lib/providers';
import ClientPage from './ClientPage';

export function generateStaticParams() {
  return allCities().map(c => ({ city: c.id }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ city: string }> },
): Promise<Metadata> {
  const { city: cityId } = await params;
  const city = getCity(cityId);
  if (!city) return {};
  return {
    title: `${city.name} · Kollektivtrafik live`,
    description: `Realtidskarta för kollektivtrafiken i ${city.name}`,
  };
}

export default async function CityPage(
  { params }: { params: Promise<{ city: string }> },
) {
  const { city: cityId } = await params;
  const city = getCity(cityId);
  if (!city) notFound();

  return <ClientPage city={city} />;
}
