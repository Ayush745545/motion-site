# Studio UI components

The components in `apps/web/src/components/ui` are shadcn/ui's open source New York components, installed as editable source from the [official registry](https://ui.shadcn.com/r/styles/new-york/button.json). They use Radix primitives for accessible dialogs, tabs, labels, and sliders. The local theme supplies neutral dark surfaces, rounded panels, and cobalt keyboard focus. The dashboard hero has a blue primary action and yellow headline highlight, following the supplied reference.

Source: [shadcn/ui](https://github.com/shadcn-ui/ui), MIT License, Copyright (c) 2023 shadcn. The original MIT license applies to those components. Component source is kept locally; the app does not fetch the registry at runtime.

`dashboard-hero.tsx` owns the dashboard introduction and four quick-navigation links. Its stylesheet is scoped to that component. `shell-refresh.css` owns navigation and the getting-started panel; `saas-theme.css` owns shared application surfaces. Editor, video workspace, and Director styles remain beside those components. Composition colors and frame-driven motion continue to come from their DNA or manual scene inputs.

Navigation switches to a drawer at 960px to give tablet previews enough space. The drawer supports keyboard dismissal, a 44px close control, and access to the getting-started guide. Quick actions wrap into two columns on narrow screens. Their thin animated edge and the GSAP entrances respect both the browser's reduced-motion preference and the saved application setting.

See [UI refresh verification](ui-refresh.md) for changed files, checks, and scope.
