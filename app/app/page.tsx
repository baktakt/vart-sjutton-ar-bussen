import { redirect } from 'next/navigation';

// Root redirects to the default city.
// When multiple cities are supported this will geolocate and pick the right one.
export default function Page() {
  redirect('/goteborg');
}
