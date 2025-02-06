import type { Config } from "tailwindcss";
import daisyui from "daisyui";

const config: Config = {
  content: ["./src/**/*.{vue,js,ts}"],
  plugins: [daisyui],
};

export default config;
