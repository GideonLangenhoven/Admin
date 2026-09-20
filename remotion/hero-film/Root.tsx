import React from "react";
import { Composition } from "remotion";
import { BookingToursHeroFilm } from "./BookingToursHeroFilm";

export const HeroFilmRoot: React.FC = () => {
  return (
    <Composition
      id="BookingToursHeroFilm"
      component={BookingToursHeroFilm}
      durationInFrames={660}
      fps={60}
      width={1920}
      height={1080}
    />
  );
};
