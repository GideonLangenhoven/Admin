-- The user requested the original Kayak layout. Restore only its presentation
-- settings from the snapshot taken before the daily demo update. Demo records,
-- tour data, packing information and refresh schedules remain untouched.
update public.businesses set
  hero_eyebrow = null,
  hero_title = null,
  hero_subtitle = null,
  hero_image = null,
  color_bg = '#e1e5f2',
  footer_line_one = null,
  footer_line_two = null
where id = '44ff11ab-c697-47de-9227-0ffa51db127c'::uuid
  and subdomain = 'kayak'
  and yoco_test_mode is true;
