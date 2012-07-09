/* 
 * File:   Effects.h
 * Author: Exiiile
 *
 * Created on June 20, 2012, 1:53 PM
 */

#ifndef EFFECTS_H
#define	EFFECTS_H
#include <libtcod/libtcod.hpp>
#include "Drawable.h"

class Effects : public Drawable {
    private:

    public:
        Effects(int x, int y, int c);
        Effects(int c, TCODColor fore,TCODColor back, bool trans, bool walk);
        Effects(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk);
        virtual ~Effects();
};

#endif	/* EFFECTS_H */

