Feature: Interactive regression scenarios have executable BDD coverage
  Background:
    Given the interactive regression page is open

  Scenario: Every interactive scenario has a BDD example
    Then every interactive scenario is listed in the BDD examples

  Scenario: An active drag can finish within its starting click tolerance
    Then active drags return to their starting position without turning clicks into drags

  Scenario Outline: Camera gestures retain their intended behavior
    When I run the interactive scenario "<scenario>"
    Then the interactive camera result is "<result>"

    Examples:
      | scenario                                               | result        |
      | Ctrl+drag up: pitch from center                         | pitch up      |
      | Ctrl+drag down: pitch clamps at 0                       | pitch zero    |
      | Ctrl+drag far up: pitch clamps at max                   | pitch max     |
      | Ctrl+drag right, just above center                      | clockwise     |
      | Ctrl+drag right, just below center                      | counterclockwise |
      | Ctrl+drag right, far above center (angular)              | clockwise     |
      | Ctrl+drag right, far below center (angular)              | counterclockwise |
      | Ctrl+drag diagonal, pitched + rotated                   | pitch and bearing |
      | Ctrl+drag fast (2 big steps)                            | pitch and bearing |
      | Ctrl+drag full circle around center                     | pitch and bearing |
      | Ctrl+drag leaving the map                               | pitch and bearing |
      | Ctrl+drag starting on a marker                          | pitch and bearing |
      | Ctrl released mid-drag                                 | pitch and bearing |
      | Ctrl pressed mid-pan (should keep panning)               | pan           |
      | Right-drag up + right                                  | pitch and bearing |
      | Ctrl+drag then plain pan                               | rotate then pan |
      | Shift+wheel rotate                                     | shift rotate  |
      | Wheel then Ctrl+drag while zoom pending                 | cancel zoom   |
      | Wheel during Ctrl+drag                                 | zoom and rotate |

  Scenario Outline: Wheel input zooms around its geographic anchor
    When I run the interactive scenario "<scenario>"
    Then the interactive camera result is "<result>"

    Examples:
      | scenario                                               | result    |
      | Wheel in at top-right, flat (control case)               | zoom in   |
      | Wheel in at top-right, rotated                          | zoom in   |
      | Wheel in at top-right, pitch 60                         | zoom in   |
      | Wheel out at bottom-left, pitch 45                      | zoom out  |
      | Wheel near horizon, pitch 75                           | zoom in   |
      | Ctrl+wheel pinch-in burst (trackpad), pitch 50           | zoom in   |
      | Ctrl+wheel pinch-out burst (trackpad), rotated           | zoom out  |
      | Ctrl+wheel mouse notches at center                      | zoom in   |
      | Low zoom rotated, wheel in (layer jump check)           | zoom in   |

  Scenario Outline: Pitched drags retain their geographic anchor
    When I run the interactive scenario "<scenario>"
    Then the interactive camera result is "pan"

    Examples:
      | scenario                                               |
      | Pan pitched 70                                         |
      | Pan pitched 70: vertical up                            |
      | Pan pitched 70: vertical down                          |
      | Pan pitched 70: horizontal left                        |
      | Pan pitched 70: horizontal right                       |
      | Pan pitched 70: diagonal up-right                       |
      | Pan pitched 70: diagonal down-left                      |
      | Pan pitched 70: reverse vertical drag                   |
      | Pan pitched 70: multi-direction loop                    |
      | Pan pitched 70, bearing 225: diagonal                   |

  Scenario Outline: Navigation reaches its destination while pitched and rotated
    When I run the interactive scenario "<scenario>"
    Then the interactive camera result is "navigate"

    Examples:
      | scenario                                               |
      | Go to: Circle                                          |
      | Go to: Polygon                                         |
      | Go to: Path                                            |
      | Go to: Kyiv                                            |
      | Go to: London                                          |
      | Go to: San Francisco                                   |
      | Go to: Washington                                      |
      | Go to: Trondheim                                       |
      | Go to: Rectangle (fit from z 0)                         |
