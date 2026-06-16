import "react";

// `webkitdirectory` (and the legacy `directory`) let a file input select an
// entire directory. They are non-standard and missing from React's DOM types,
// so augment InputHTMLAttributes to allow them without casts.
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}
