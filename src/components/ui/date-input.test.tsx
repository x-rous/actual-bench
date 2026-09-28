import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { DateInput } from "./date-input"

function Field({ initial = "", dateFormat = "dd/MM/yyyy", onValue = () => {} }: {
  initial?: string
  dateFormat?: string
  onValue?: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <DateInput
      aria-label="Start date"
      dateFormat={dateFormat}
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe("DateInput", () => {
  it("shows the stored date in the budget's format", () => {
    render(<Field initial="2026-08-15" />)
    expect(screen.getByLabelText("Start date")).toHaveValue("15/08/2026")
  })

  it("takes a date typed as free text, on Enter", () => {
    const onValue = jest.fn()
    render(<Field onValue={onValue} />)
    const field = screen.getByLabelText("Start date")

    fireEvent.change(field, { target: { value: "5/8/2026" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onValue).toHaveBeenLastCalledWith("2026-08-05")
    expect(field).toHaveValue("05/08/2026")
  })

  it("saves once when Enter is followed by the field losing focus", () => {
    // A table that moves to the next cell on Enter blurs the field straight
    // after, before the new value has come back from the parent.
    const onValueChange = jest.fn()
    render(<DateInput aria-label="Start date" dateFormat="dd/MM/yyyy" value="" onValueChange={onValueChange} />)
    const field = screen.getByLabelText("Start date")

    fireEvent.change(field, { target: { value: "5/8/2026" } })
    fireEvent.keyDown(field, { key: "Enter" })
    fireEvent.blur(field)

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("2026-08-05")
  })

  it("keeps text that is not a date on screen and saves nothing", () => {
    const onValue = jest.fn()
    render(<Field initial="2026-08-15" onValue={onValue} />)
    const field = screen.getByLabelText("Start date")

    fireEvent.change(field, { target: { value: "31/02/2026" } })
    fireEvent.blur(field)

    expect(onValue).not.toHaveBeenCalled()
    expect(field).toHaveValue("31/02/2026")
    expect(field).toHaveAttribute("aria-invalid", "true")
  })

  it("clears the date when the field is emptied", () => {
    const onValue = jest.fn()
    render(<Field initial="2026-08-15" onValue={onValue} />)
    const field = screen.getByLabelText("Start date")

    fireEvent.change(field, { target: { value: "" } })
    fireEvent.blur(field)

    expect(onValue).toHaveBeenLastCalledWith("")
  })

  it("zooms out from the month to pick another month and year", async () => {
    const onValue = jest.fn()
    render(<Field initial="2026-08-15" onValue={onValue} />)

    fireEvent.click(screen.getByRole("button", { name: "Choose start date from a calendar" }))
    // Days, then months of 2026, then a grid of years.
    fireEvent.click(await screen.findByRole("button", { name: "August 2026, choose another month" }))
    fireEvent.click(screen.getByRole("button", { name: "2026, choose another year" }))
    fireEvent.click(screen.getByRole("button", { name: "2024" }))
    // Back to the months, now of 2024, then to the days of the month picked.
    fireEvent.click(screen.getByRole("button", { name: "March 2024" }))
    expect(screen.getByRole("button", { name: "March 2024, choose another month" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /March 10th, 2024/ }))
    expect(onValue).toHaveBeenLastCalledWith("2024-03-10")
    expect(screen.getByLabelText("Start date")).toHaveValue("10/03/2024")
  })
})
