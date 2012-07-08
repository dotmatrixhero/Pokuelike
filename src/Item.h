/* 
 * File:   Items.h
 * Author: Exiiile
 *
 * Created on June 20, 2012, 1:52 PM
 */

#ifndef ITEMS_H
#define	ITEMS_H

#include <libtcod/libtcod.hpp>
#include "Drawable.h"

class Item: public Drawable {
    private:

    public:
        Item(int x, int y, int c);
        Item(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Item(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk);
        virtual ~Item();
};

#endif	/* ITEMS_H */
