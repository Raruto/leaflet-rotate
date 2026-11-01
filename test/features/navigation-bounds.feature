@navigation-bounds
Feature: Navigation limits on rotated and pitched maps
  Background:
    Given a map with the Paris navigation limits is open

  Scenario Outline: Zoom and programmatic navigation respect the transformed viewport
    When navigation rotation is <enabled> with bearing <bearing> and pitch <pitch>
    Then minimum zoom 14 applies to view changes, wheel zoom and pinch zoom
    And maximum bounds constrain programmatic pans and camera changes

    Examples:
      | enabled | bearing | pitch |
      | false   | 0       | 0     |
      | true    | 0       | 0     |
      | true    | 45      | 0     |
      | true    | 135     | 45    |
      | true    | 270     | 85    |

  Scenario Outline: Viscosity limits the geographic footprint during dragging
    When navigation rotation is <enabled> with bearing <bearing> and pitch <pitch>
    Then viscosity 1 prevents crossing maximum bounds during a mouse drag
    And viscosities 0 and 0.5 allow progressively less overshoot
    And maximum bounds are restored after drag inertia

    Examples:
      | enabled | bearing | pitch |
      | false   | 0       | 0     |
      | true    | 0       | 0     |
      | true    | 45      | 0     |
      | true    | 135     | 45    |
      | true    | 270     | 85    |
