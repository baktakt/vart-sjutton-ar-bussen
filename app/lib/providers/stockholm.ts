import type { CityConfig } from './types';

const stockholm: CityConfig = {
  id: 'stockholm',
  name: 'Stockholm',
  defaultCenter: [59.3293, 18.0686],
  defaultZoom: 13,
  defaultBounds: {
    lowerLeftLat:   59.15,
    lowerLeftLong:  17.75,
    upperRightLat:  59.55,
    upperRightLong: 18.40,
  },
  shapesPath: '/shapes/stockholm',
};

export default stockholm;
