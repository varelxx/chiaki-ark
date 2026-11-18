-- Enlaces directos: tiradas generadas desde el panel para enviarlas a mano (WhatsApp, Discord, chat
-- de la tienda...), sin pedido ni correo. Se guardan con correo = '' y una nota opcional para saber
-- a quién se le dio cada enlace.
ALTER TABLE tiradas ADD COLUMN nota TEXT;
