// Registry of furniture modules. Each module exports `items`: { name: () => THREE.Group } built with ../kit.js.
export const MODULES = {
  living: () => import('./living.js'),
  kitchen: () => import('./kitchen.js'),
  dining: () => import('./dining.js'),
  bedrooms: () => import('./bedrooms.js'),
  bath: () => import('./bath.js'),
  outdoor: () => import('./outdoor.js'),
  plants: () => import('./plants.js'),
  decor: () => import('./decor_plus.js'),
};
