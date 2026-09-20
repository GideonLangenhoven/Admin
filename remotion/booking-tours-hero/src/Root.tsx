import {Composition} from "remotion";
import {BookingToursHero} from "./BookingToursHero";

export const RemotionRoot = () => (
  <Composition
    id="BookingToursHero"
    component={BookingToursHero}
    durationInFrames={720}
    fps={60}
    width={1920}
    height={1080}
  />
);
