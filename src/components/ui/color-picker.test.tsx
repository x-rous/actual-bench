import { fireEvent, render, screen } from "@testing-library/react";
import { ColorPicker } from "./color-picker";

function open(props: Partial<React.ComponentProps<typeof ColorPicker>> = {}) {
  const onChange = jest.fn();
  render(<ColorPicker ariaLabel="Colour" value="#3b82f6" onChange={onChange} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Colour" }));
  return onChange;
}

describe("ColorPicker", () => {
  it("picks from the palette", () => {
    const onChange = open();
    fireEvent.click(screen.getByRole("radio", { name: "#ef4444" }));
    expect(onChange).toHaveBeenCalledWith("#ef4444");
  });

  it("marks the current colour in the palette", () => {
    open();
    expect(screen.getByRole("radio", { name: "#3b82f6" })).toBeChecked();
  });

  it("takes a typed hex in custom mode, short form included, and ignores partial text", () => {
    const onChange = open();
    fireEvent.click(screen.getByRole("tab", { name: "Custom" }));
    const hex = screen.getByLabelText("Hex colour");
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: "#0af" } });
    expect(onChange).toHaveBeenLastCalledWith("#00aaff");
  });

  it("keeps arrow keys inside the picker, away from a grid it was opened from", () => {
    const onKeyDown = jest.fn();
    render(<div onKeyDown={onKeyDown}><ColorPicker ariaLabel="Colour" value="#3b82f6" onChange={jest.fn()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Colour" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "#3b82f6" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("tab", { name: "Custom" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Saturation and brightness" }), { key: "ArrowLeft" });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("offers Clear only when asked and a colour is set", () => {
    const onClear = jest.fn();
    open({ onClear });
    fireEvent.click(screen.getByRole("button", { name: "Clear colour" }));
    expect(onClear).toHaveBeenCalled();
  });
});
