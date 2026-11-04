import QRCode from "qrcode";

export const galleryQr = url => QRCode.toDataURL(url, {
  width: 240, margin: 2, errorCorrectionLevel: "M",
  color: { dark: "#234536", light: "#ffffff" },
});
