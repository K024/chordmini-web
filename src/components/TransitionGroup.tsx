import {
  Children, cloneElement, isValidElement,
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "preact/compat"


export function useTransitionState(isOpen: boolean, duration = 300, appear = true) {
  const [state, setState] = useState({ isOpen: appear ? false : isOpen, transitioning: false })
  const durationRef = useRef(duration)
  durationRef.current = duration
  const timeoutRef = useRef<any>(null)

  useEffect(() => {
    if (state.isOpen === isOpen) return
    setTimeout(
      () => setState({ isOpen, transitioning: true }),
      0,
    )
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(
      () => setState({ isOpen, transitioning: false }),
      durationRef.current,
    )
  }, [isOpen, state.isOpen])

  return {
    beforeOpen: isOpen && !state.isOpen,
    opening: isOpen && state.isOpen && state.transitioning,
    open: isOpen && state.isOpen,
    beforeClose: !isOpen && state.isOpen,
    closing: !isOpen && !state.isOpen && state.transitioning,
    closed: !isOpen && !state.isOpen,
    show: state.transitioning || state.isOpen || isOpen,
  }
}


function elements(children: React.PropsWithChildren["children"]) {
  const array: React.ReactElement[] = []
  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      array.push(child as React.ReactElement)
    }
  })
  return array
}


function elementKey(element: React.ReactElement) {
  return element.key || ""
}


export interface TransitionGroupProps extends React.PropsWithChildren {
  exitDuration?: number
}

/**
 * Will inject a `show={false}` prop to the exiting child when the component is removed from the children list.
 * The exit duration is the minimum time the child will be visible for, but is not guaranteed.
 */
export function TransitionGroup({ children, exitDuration = 500 }: TransitionGroupProps) {

  const currentChildren = useMemo(() => elements(children), [children])

  const currentKeys = currentChildren.map(elementKey)

  // store rendered children
  const lastChildren = useRef(currentChildren)

  const [syncedChildren, setSyncedChildren] = useState(currentChildren)

  const synced = syncedChildren === currentChildren


  let childrenToRender = currentChildren
  if (!synced) {
    childrenToRender = [...currentChildren]
    for (let i = 0; i < lastChildren.current.length; i++) {
      const child = lastChildren.current[i]
      const key = elementKey(child)

      if (currentKeys.indexOf(key) === -1) {
        // insert exiting child
        childrenToRender.splice(i, 0,
          cloneElement(child, {
            show: false
          } as any)
        )
      }
    }
  }

  lastChildren.current = childrenToRender

  useLayoutEffect(() => {
    if (!synced) {
      const timeout = setTimeout(() => {
        setSyncedChildren(currentChildren)
      }, exitDuration)
      return () => clearTimeout(timeout)
    }
  })

  return <>{childrenToRender}</>
}
