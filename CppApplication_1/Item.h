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
public:
    Item(int,int,int,TCODColor, TCODColor, bool, bool);
    Item(int, TCODColor,TCODColor,bool ,bool );
    Item(const Item& orig);
    virtual ~Item();
private:

};

#endif	/* ITEMS_H */
